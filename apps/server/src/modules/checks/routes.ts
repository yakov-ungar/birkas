import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { checkCreateSchema, formatMoney, type CheckRow, type CheckStatus } from '@tuition/shared';
import { staff } from '../../plugins/access';
import { actorOf } from '../../plugins/auth';
import { conflict, notFound, parse } from '../../lib/errors';
import { recordAudit } from '../audit/service';
import { getSettings } from '../settings/service';
import { addCharge } from '../finance/charges';
import { todayOf } from '../finance/context';
import { autoSendReceipt, recordPayment, reversePayment } from '../payments/service';
import type { Deps } from '../../deps';

const idParam = z.object({ id: z.string().min(1).max(40) });

/** Deposit: the check becomes a payment with a receipt (decision A4: receipt at deposit, as in the demo). */
async function deposit(deps: Deps, req: FastifyRequest, id: string) {
  const { db, clock } = deps;
  const now = clock.now();
  const today = todayOf(deps);
  const out = await db.$transaction(async (tx) => {
    const c = await tx.check.findUnique({ where: { id }, include: { student: true } });
    if (!c) throw notFound('השיק לא נמצא');
    if (c.status !== 'pending') throw conflict('אפשר להפקיד רק שיק ממתין');
    const { payment, receipt } = await recordPayment(tx, now, actorOf(req), {
      familyId: c.familyId,
      method: 'check',
      amountAgorot: c.amountAgorot,
      date: today,
      reference: `שיק ${c.number} · ${c.bank}`,
      parts: [{ studentId: c.studentId, amountAgorot: c.amountAgorot }],
      idempotencyKey: `check:${c.id}`,
      source: 'check',
      checkId: c.id,
      createdById: req.auth!.user.id,
    });
    await tx.check.update({
      where: { id },
      data: { status: 'deposited', paymentId: payment.id, depositedAt: now },
    });
    await recordAudit(tx, actorOf(req), now, {
      action: 'check.deposit',
      summary: `הופקד שיק ${c.number} (${formatMoney(c.amountAgorot)})`,
      entity: 'Check',
      entityId: id,
    });
    return { familyId: c.familyId, receiptId: receipt.id, number: receipt.number };
  });
  await autoSendReceipt(deps, req.log, out.familyId, out.receiptId);
  return out;
}

export async function checkRoutes(app: FastifyInstance) {
  const deps = app.deps;
  const { db, clock } = deps;

  app.get('/api/checks', { config: { access: staff('checks') } }, async () => {
    const today = todayOf(deps);
    const rows = await db.check.findMany({
      include: { student: { select: { fullName: true } } },
      orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
    });
    const receipts = await db.receipt.findMany({
      where: { paymentId: { in: rows.map((r) => r.paymentId).filter((x): x is string => !!x) } },
      select: { id: true, paymentId: true },
    });
    const byPayment = new Map(receipts.map((r) => [r.paymentId, r.id]));
    const out: CheckRow[] = rows.map((c) => ({
      id: c.id,
      dueDate: c.dueDate,
      studentId: c.studentId,
      studentName: c.student.fullName,
      number: c.number,
      bank: c.bank,
      amountAgorot: c.amountAgorot,
      status: c.status as CheckStatus,
      dueReached: c.status === 'pending' && c.dueDate <= today,
      receiptId: c.paymentId ? (byPayment.get(c.paymentId) ?? null) : null,
    }));
    return { checks: out };
  });

  app.post('/api/checks', { config: { access: staff('checks') } }, async (req) => {
    const input = parse(checkCreateSchema, req.body);
    const existing = await db.check.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return { id: existing.id };
    return db.$transaction(async (tx) => {
      const s = await tx.student.findFirst({ where: { id: input.studentId, deletedAt: null } });
      if (!s) throw notFound('התלמיד לא נמצא');
      const c = await tx.check.create({
        data: {
          studentId: s.id,
          familyId: s.familyId,
          number: input.number,
          bank: input.bank,
          amountAgorot: input.amountAgorot,
          dueDate: input.dueDate,
          idempotencyKey: input.idempotencyKey,
          createdById: req.auth!.user.id,
        },
      });
      await recordAudit(tx, actorOf(req), clock.now(), {
        action: 'check.create',
        summary: `נרשם שיק ${c.number} ${formatMoney(c.amountAgorot)} ל${s.fullName}`,
        entity: 'Check',
        entityId: c.id,
        after: c,
      });
      return { id: c.id };
    });
  });

  app.post('/api/checks/:id/deposit', { config: { access: staff('checks') } }, async (req) =>
    deposit(deps, req, parse(idParam, req.params).id),
  );

  app.post('/api/checks/deposit-due', { config: { access: staff('checks') } }, async (req) => {
    const due = await db.check.findMany({
      where: { status: 'pending', dueDate: { lte: todayOf(deps) } },
      orderBy: { dueDate: 'asc' },
    });
    let total = 0;
    for (const c of due) {
      await deposit(deps, req, c.id);
      total += c.amountAgorot;
    }
    return { count: due.length, totalAgorot: total };
  });

  /** Bounced check: the payment is reversed with a credit note (B4) and the return fee is charged. */
  app.post('/api/checks/:id/return', { config: { access: staff('checks') } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const now = clock.now();
    const today = todayOf(deps);
    const actor = actorOf(req);
    const { checkReturnFeeAgorot, activeYearName } = await getSettings(db);
    return db.$transaction(async (tx) => {
      const c = await tx.check.findUnique({ where: { id } });
      if (!c) throw notFound('השיק לא נמצא');
      if (c.status !== 'deposited' || !c.paymentId) throw conflict('אפשר לסמן כחוזר רק שיק שהופקד');
      const { reversal, note } = await reversePayment(tx, now, actor, {
        paymentId: c.paymentId,
        reason: `שיק חוזר ${c.number}`,
        reference: `שיק חוזר ${c.number}`,
        date: today,
        createdById: req.auth!.user.id,
      });
      let feeChargeId: string | null = null;
      if (checkReturnFeeAgorot > 0) {
        const fee = await addCharge(tx, {
          studentId: c.studentId,
          type: 'check_fee',
          description: `עמלת שיק חוזר ${c.number}`,
          amountAgorot: checkReturnFeeAgorot,
          date: today,
          yearName: activeYearName,
          createdById: req.auth!.user.id,
        });
        feeChargeId = fee.id;
      }
      await tx.check.update({
        where: { id },
        data: { status: 'returned', returnPaymentId: reversal.id, feeChargeId, returnedAt: now },
      });
      await recordAudit(tx, actor, now, {
        action: 'check.return',
        summary: `שיק ${c.number} חזר: בוטל תשלום ${formatMoney(c.amountAgorot)}${feeChargeId ? `, חויבה עמלה ${formatMoney(checkReturnFeeAgorot)}` : ''}`,
        entity: 'Check',
        entityId: id,
      });
      return { creditNoteNumber: note.number, feeAgorot: feeChargeId ? checkReturnFeeAgorot : 0 };
    });
  });

  app.post('/api/checks/:id/cancel', { config: { access: staff('checks') } }, async (req) => {
    const { id } = parse(idParam, req.params);
    return db.$transaction(async (tx) => {
      const c = await tx.check.findUnique({ where: { id } });
      if (!c) throw notFound('השיק לא נמצא');
      if (c.status !== 'pending') throw conflict('אפשר לבטל רק שיק שטרם הופקד');
      await tx.check.update({ where: { id }, data: { status: 'cancelled' } });
      await recordAudit(tx, actorOf(req), clock.now(), {
        action: 'check.cancel',
        summary: `בוטל רישום שיק ${c.number}`,
        entity: 'Check',
        entityId: id,
      });
      return { ok: true };
    });
  });
}
