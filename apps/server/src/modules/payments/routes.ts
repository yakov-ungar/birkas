import { assertHostedCards } from './nedarim-config';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  formatMoney,
  paymentCreateSchema,
  refundCreateSchema,
  type PaymentCreateInput,
  type PaymentResult,
} from '@tuition/shared';
import { staff } from '../../plugins/access';
import { actorOf } from '../../plugins/auth';
import { badRequest, forbidden, notFound, parse } from '../../lib/errors';
import { allocate, allocationProblem, type Part } from '../../domain/allocate';
import { recordAudit } from '../audit/service';
import { balancesOf } from '../finance/money';
import { hasPerm, todayOf } from '../finance/context';
import { cardRow } from '../families/routes';
import { issueDocument } from '../receipts/service';
import { autoSendReceipt, openCashSessionId, recordPayment, resultOf } from './service';
import { payByCard } from './card';
import type { Deps } from '../../deps';

/** Resolves who the payment is for and how it splits between the kids. */
export async function resolveParts(
  deps: Deps,
  input: PaymentCreateInput,
): Promise<{ familyId: string; parts: Part[] }> {
  const { db } = deps;
  if (input.studentId) {
    const s = await db.student.findFirst({ where: { id: input.studentId, deletedAt: null } });
    if (!s) throw notFound('התלמיד לא נמצא');
    if (input.allocations) throw badRequest('חלוקה ידנית אפשרית רק בתשלום משפחתי');
    return { familyId: s.familyId, parts: [{ studentId: s.id, amountAgorot: input.amountAgorot }] };
  }
  const kids = await db.student.findMany({
    where: { familyId: input.familyId!, deletedAt: null },
    orderBy: { enrollSeq: 'asc' },
  });
  if (!kids.length) throw notFound('המשפחה לא נמצאה או שאין בה תלמידים');
  if (input.allocations) {
    const parts = input.allocations.filter((a) => a.amountAgorot > 0);
    const problem = allocationProblem(input.allocations, input.amountAgorot, new Set(kids.map((k) => k.id)));
    if (problem) throw badRequest(problem, { allocations: problem });
    return { familyId: input.familyId!, parts };
  }
  const bal = await balancesOf(
    db,
    kids.map((k) => k.id),
  );
  return {
    familyId: input.familyId!,
    parts: allocate(
      kids.map((k) => ({ studentId: k.id, balanceAgorot: bal.get(k.id) ?? 0 })),
      input.amountAgorot,
    ),
  };
}

export async function paymentRoutes(app: FastifyInstance) {
  const deps = app.deps;
  const { db, clock } = deps;

  app.get('/api/payments/allocation', { config: { access: staff('pay') } }, async (req) => {
    const { familyId, amountAgorot } = parse(
      z.object({ familyId: z.string().min(1).max(40), amountAgorot: z.coerce.number().int().positive() }),
      req.query,
    );
    const kids = await db.student.findMany({
      where: { familyId, deletedAt: null },
      orderBy: { enrollSeq: 'asc' },
    });
    if (!kids.length) throw notFound('המשפחה לא נמצאה');
    const bal = await balancesOf(
      db,
      kids.map((k) => k.id),
    );
    const parts = allocate(
      kids.map((k) => ({ studentId: k.id, balanceAgorot: bal.get(k.id) ?? 0 })),
      amountAgorot,
    );
    return {
      students: kids.map((k) => ({
        studentId: k.id,
        fullName: k.fullName,
        balanceAgorot: bal.get(k.id) ?? 0,
        amountAgorot: parts.find((p) => p.studentId === k.id)?.amountAgorot ?? 0,
      })),
    };
  });

  app.get('/api/families/:id/payment-cards', { config: { access: staff('pay') } }, async (req) => {
    const { id } = parse(z.object({ id: z.string().min(1).max(40) }), req.params);
    const today = todayOf(deps);
    const cards = await db.savedCard.findMany({
      where: { removedAt: null, student: { familyId: id, deletedAt: null } },
      include: { student: { select: { fullName: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return {
      cards: cards.map((c) => cardRow(c, c.student.fullName, today)),
      hostedFieldsUrl: deps.payments.hostedFieldsUrl(),
    };
  });

  app.post('/api/payments', { config: { access: staff('pay') } }, async (req): Promise<PaymentResult> => {
    const input = parse(paymentCreateSchema, req.body);
    const now = clock.now();
    const today = todayOf(deps);
    const actor = actorOf(req);
    const userId = req.auth!.user.id;
    const d = input.details;

    // Idempotency: the same form submitted twice returns the first result.
    const existing = await db.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return db.$transaction((tx) => resultOf(tx, existing.id));
    const existingCheck = await db.check.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existingCheck) return { paymentId: null, receipt: null, checkId: existingCheck.id, allocations: [] };

    const { familyId, parts } = await resolveParts(deps, input);

    if (d.method === 'check') {
      // Demo: a check is registered for one student and counts toward the balance only once deposited (stage 4).
      const studentId = parts[0]!.studentId;
      const check = await db.$transaction(async (tx) => {
        const c = await tx.check.create({
          data: {
            studentId,
            familyId,
            number: d.number,
            bank: d.bank,
            amountAgorot: input.amountAgorot,
            dueDate: d.dueDate,
            idempotencyKey: input.idempotencyKey,
            createdById: userId,
          },
        });
        await recordAudit(tx, actor, now, {
          action: 'check.create',
          summary: `נרשם שיק ${d.number} ${formatMoney(c.amountAgorot)}`,
          entity: 'Check',
          entityId: c.id,
          after: c,
        });
        return c;
      });
      return { paymentId: null, receipt: null, checkId: check.id, allocations: [] };
    }

    if (d.method === 'cash' || d.method === 'transfer') {
      const result = await db.$transaction(async (tx) => {
        const { payment } = await recordPayment(tx, now, actor, {
          familyId,
          method: d.method,
          amountAgorot: input.amountAgorot,
          date: d.method === 'transfer' ? d.date : today,
          reference: d.method === 'transfer' ? `${d.bank} · ${d.reference}` : `קיבל: ${d.receivedBy}`,
          parts,
          idempotencyKey: input.idempotencyKey,
          source: 'staff',
          createdById: userId,
        });
        return resultOf(tx, payment.id);
      });
      if (result.receipt) await autoSendReceipt(deps, req.log, familyId, result.receipt.id);
      return result;
    }

    // ---------- card ----------
    await assertHostedCards(deps);
    if (!!d.cardId === !!d.newCard) throw badRequest('יש לבחור כרטיס שמור או להזין כרטיס חדש');
    if (d.newCard?.save && !hasPerm(req, 'cards')) throw forbidden('אין לך הרשאה לשמור כרטיסים');
    return payByCard(deps, req.log, {
      familyId,
      parts,
      amountAgorot: input.amountAgorot,
      idempotencyKey: input.idempotencyKey,
      cardId: d.cardId,
      newCard: d.newCard,
      actor,
      source: 'staff',
      createdById: userId,
    });
  });

  /** Refund of a credit balance (cash or transfer only; card refunds go through receipt cancellation, A8). */
  app.post('/api/refunds', { config: { access: staff('pay') } }, async (req) => {
    const input = parse(refundCreateSchema, req.body);
    const existing = await db.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return db.$transaction((tx) => resultOf(tx, existing.id));
    const now = clock.now();
    const today = todayOf(deps);
    const actor = actorOf(req);
    return db.$transaction(async (tx) => {
      const s = await tx.student.findFirst({
        where: { id: input.studentId, deletedAt: null },
        include: { family: true },
      });
      if (!s) throw notFound('התלמיד לא נמצא');
      const credit = -((await balancesOf(tx, [s.id])).get(s.id) ?? 0);
      if (credit <= 0) throw badRequest('אין יתרת זכות להחזר');
      if (input.amountAgorot > credit)
        throw badRequest(`סכום ההחזר גבוה מיתרת הזכות (${formatMoney(credit)})`, {
          amountAgorot: 'סכום החזר לא תקין',
        });
      const payment = await tx.payment.create({
        data: {
          familyId: s.familyId,
          method: input.method,
          amountAgorot: -input.amountAgorot,
          date: today,
          reference: `החזר: ${input.reason}`,
          kind: 'refund',
          cashSessionId: input.method === 'cash' ? await openCashSessionId(tx) : null,
          idempotencyKey: input.idempotencyKey,
          source: 'staff',
          createdById: req.auth!.user.id,
          allocations: { create: [{ studentId: s.id, amountAgorot: -input.amountAgorot }] },
        },
      });
      const doc = await issueDocument(tx, now, {
        docType: 'refund',
        paymentId: payment.id,
        familyId: s.familyId,
        date: today,
        payerName: s.family.parentName,
        amountAgorot: input.amountAgorot,
        method: input.method,
        reference: payment.reference,
        lines: [{ studentId: s.id, amountAgorot: input.amountAgorot }],
        reason: input.reason,
      });
      await recordAudit(tx, actor, now, {
        action: 'payment.refund',
        summary: `החזר ${formatMoney(input.amountAgorot)} ל${s.fullName} (אישור החזר ${doc.number})`,
        entity: 'Payment',
        entityId: payment.id,
        after: payment,
      });
      return resultOf(tx, payment.id);
    });
  });
}
