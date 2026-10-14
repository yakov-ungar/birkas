import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  bankImportSchema,
  bankRegisterSchema,
  formatMoney,
  masavCreateSchema,
  masavReturnSchema,
  parseShekels,
  type BankTxnRow,
  type MasavExportRow,
  type StandingOrderRow,
} from '@tuition/shared';
import { staff } from '../../plugins/access';
import { actorOf } from '../../plugins/auth';
import { badRequest, conflict, notFound, parse } from '../../lib/errors';
import { sha256 } from '../../lib/crypto';
import { recordAudit } from '../audit/service';
import { allocate } from '../../domain/allocate';
import { balancesOf } from '../finance/money';
import { todayOf } from '../finance/context';
import { readRows } from '../families/import';
import { autoSendReceipt, recordPayment, reversePayment } from '../payments/service';
import { refreshCompletion, topUpRecurring } from '../plans/service';
import { matchTransfer, parseBankDate, type FamilyCandidate } from './matching';
import type { Db, Tx } from '../../lib/db';

const idParam = z.object({ id: z.string().min(1).max(40) });

const COLS = {
  date: ['תאריך', 'תאריך ערך', 'תאריך התנועה', 'תאריך פעולה'],
  description: ['תיאור', 'תיאור התנועה', 'פרטים', 'הפעולה', 'תאור', 'תאור התנועה'],
  reference: ['אסמכתא', 'אסמכתה', 'מספר אסמכתא'],
  credit: ['זכות', 'בזכות', 'סכום זכות'],
  amount: ['סכום'],
} as const;

async function candidates(db: Db | Tx): Promise<FamilyCandidate[]> {
  const fams = await db.family.findMany({
    where: { archivedAt: null },
    include: { students: { where: { deletedAt: null }, select: { id: true } } },
  });
  const ids = fams.flatMap((f) => f.students.map((s) => s.id));
  const bal = await balancesOf(db, ids);
  const open = await db.planCharge.findMany({
    where: {
      status: { in: ['expected', 'pending'] },
      plan: { status: 'active', method: 'transfer', studentId: { in: ids } },
    },
    include: { plan: { select: { studentId: true } } },
    orderBy: { dueDate: 'asc' },
  });
  return fams.map((f) => {
    const kids = new Set(f.students.map((s) => s.id));
    return {
      id: f.id,
      name: f.name,
      parentName: f.parentName,
      balanceAgorot: f.students.reduce((a, s) => a + (bal.get(s.id) ?? 0), 0),
      expected: open
        .filter((c) => kids.has(c.plan.studentId))
        .map((c) => ({ planChargeId: c.id, amountAgorot: c.amountAgorot })),
    };
  });
}

/** Account numbers are only decrypted to build the file, never returned by the API. */
function masavFile(
  e: { chargeDate: string; id: string },
  items: {
    amountAgorot: number;
    bank: string;
    branch: string;
    account: string;
    studentName: string;
    ref: string;
  }[],
) {
  const lines = [
    '# קובץ הדגמה בלבד - לא לשליחה לבנק. פורמט מס״ב הרשמי ייבנה לפי המפרט (שאלה א7).',
    `# מזהה קובץ: ${e.id} · תאריך חיוב: ${e.chargeDate} · שורות: ${items.length} · סה״כ באגורות: ${items.reduce((a, i) => a + i.amountAgorot, 0)}`,
    'תאריך חיוב|בנק|סניף|חשבון|סכום באגורות|תלמיד|אסמכתא',
    ...items.map((i) =>
      [e.chargeDate, i.bank, i.branch, i.account, i.amountAgorot, i.studentName, i.ref].join('|'),
    ),
  ];
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export async function bankRoutes(app: FastifyInstance) {
  const deps = app.deps;
  const { db, clock } = deps;

  // ---------- bank statement ----------
  app.get('/api/bank/transactions', { config: { access: staff('bank') } }, async () => {
    const rows = await db.bankTransaction.findMany({
      orderBy: [{ status: 'asc' }, { date: 'desc' }],
      take: 500,
    });
    const famIds = [
      ...new Set(rows.flatMap((r) => [r.suggestedFamilyId, r.familyId]).filter((x): x is string => !!x)),
    ];
    const fams = new Map(
      (await db.family.findMany({ where: { id: { in: famIds } }, select: { id: true, name: true } })).map(
        (f) => [f.id, f.name],
      ),
    );
    const receipts = await db.receipt.findMany({
      where: { paymentId: { in: rows.map((r) => r.paymentId).filter((x): x is string => !!x) } },
      select: { id: true, paymentId: true },
    });
    const byPayment = new Map(receipts.map((r) => [r.paymentId, r.id]));
    const out: BankTxnRow[] = rows.map((r) => ({
      id: r.id,
      date: r.date,
      description: r.description,
      reference: r.reference,
      amountAgorot: r.amountAgorot,
      status: r.status as BankTxnRow['status'],
      matchLevel: r.matchLevel as BankTxnRow['matchLevel'],
      matchReason: r.matchReason,
      suggestedFamily: r.suggestedFamilyId
        ? { id: r.suggestedFamilyId, name: fams.get(r.suggestedFamilyId) ?? '' }
        : null,
      familyName: r.familyId ? (fams.get(r.familyId) ?? null) : null,
      receiptId: r.paymentId ? (byPayment.get(r.paymentId) ?? null) : null,
    }));
    return { transactions: out };
  });

  /** Generic CSV / Excel statement (decision C7, until the bank's own format is provided). */
  app.post(
    '/api/bank/import',
    { config: { access: staff('bank') }, bodyLimit: 10 * 1024 * 1024 },
    async (req) => {
      const input = parse(bankImportSchema, req.body);
      const buf = Buffer.from(input.contentBase64, 'base64');
      const fileHash = sha256(buf.toString('base64'));
      if (await db.bankImport.findUnique({ where: { fileHash } })) throw conflict('הקובץ הזה כבר יובא');
      const rows = await readRows(input.fileName, buf);
      const headerIdx = rows.findIndex((r) =>
        r.some((c) => (COLS.date as readonly string[]).includes(c.trim())),
      );
      if (headerIdx < 0) throw badRequest('לא נמצאה שורת כותרות עם עמודת "תאריך"');
      const header = rows[headerIdx]!.map((h) => h.trim());
      const col = (names: readonly string[]) => header.findIndex((h) => names.includes(h));
      const ix = {
        date: col(COLS.date),
        description: col(COLS.description),
        reference: col(COLS.reference),
        credit: col(COLS.credit),
        amount: col(COLS.amount),
      };
      if (ix.description < 0) throw badRequest('חסרה עמודת תיאור (תיאור / פרטים / הפעולה)');
      if (ix.credit < 0 && ix.amount < 0) throw badRequest('חסרה עמודת סכום (זכות / סכום)');

      const fams = await candidates(db);
      const now = clock.now();
      const seen = new Map<string, number>();
      let imported = 0;
      let duplicates = 0;
      let skipped = 0;
      let matched = 0;
      await db.$transaction(
        async (tx) => {
          const imp = await tx.bankImport.create({
            data: {
              fileName: input.fileName,
              fileHash,
              importedAt: now,
              importedById: req.auth!.user.id,
              rows: 0,
              matched: 0,
            },
          });
          for (const r of rows.slice(headerIdx + 1)) {
            const at = (i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
            const date = parseBankDate(at(ix.date));
            const amount = parseShekels(at(ix.credit >= 0 ? ix.credit : ix.amount));
            if (!date || amount === null || amount <= 0) {
              if (r.some((c) => c.trim())) skipped++; // debits, balances, blank or summary lines
              continue;
            }
            const description = at(ix.description);
            const reference = at(ix.reference);
            const base = `${date}|${amount}|${description}|${reference}`;
            const n = (seen.get(base) ?? 0) + 1;
            seen.set(base, n);
            const rowHash = sha256(`${base}|${n}`);
            if (await tx.bankTransaction.findUnique({ where: { rowHash } })) {
              duplicates++;
              continue;
            }
            const m = matchTransfer(description, amount, fams);
            if (m.level !== 'none') matched++;
            await tx.bankTransaction.create({
              data: {
                importId: imp.id,
                date,
                description,
                reference,
                amountAgorot: amount,
                rowHash,
                suggestedFamilyId: m.familyId,
                suggestedPlanChargeId: m.planChargeId,
                matchLevel: m.level,
                matchReason: m.reason,
              },
            });
            imported++;
          }
          await tx.bankImport.update({ where: { id: imp.id }, data: { rows: imported, matched } });
          await recordAudit(tx, actorOf(req), now, {
            action: 'bank.import',
            summary: `יובא דף בנק: ${imported} זיכויים (${matched} זוהו, ${duplicates} כפולים)`,
            entity: 'BankImport',
            entityId: imp.id,
          });
        },
        { timeout: 60_000 },
      );
      return { imported, matched, duplicates, skipped };
    },
  );

  app.post('/api/bank/transactions/:id/register', { config: { access: staff('bank') } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { familyId } = parse(bankRegisterSchema, req.body);
    const now = clock.now();
    const actor = actorOf(req);
    const out = await db.$transaction(async (tx) => {
      const t = await tx.bankTransaction.findUnique({ where: { id } });
      if (!t) throw notFound('התנועה לא נמצאה');
      if (t.status !== 'pending') throw conflict('התנועה כבר טופלה');
      const kids = await tx.student.findMany({
        where: { familyId, deletedAt: null },
        orderBy: { enrollSeq: 'asc' },
      });
      if (!kids.length) throw notFound('המשפחה לא נמצאה');
      // A transfer that pays a transfer-plan installment of exactly this amount settles it (B5).
      const pc = await tx.planCharge.findFirst({
        where: {
          status: { in: ['expected', 'pending'] },
          amountAgorot: t.amountAgorot,
          plan: { status: 'active', method: 'transfer', studentId: { in: kids.map((k) => k.id) } },
          ...(t.suggestedPlanChargeId ? { id: t.suggestedPlanChargeId } : {}),
        },
        include: { plan: true },
        orderBy: { dueDate: 'asc' },
      });
      let parts;
      if (pc) parts = [{ studentId: pc.plan.studentId, amountAgorot: t.amountAgorot }];
      else {
        const bal = await balancesOf(
          tx,
          kids.map((k) => k.id),
        );
        parts = allocate(
          kids.map((k) => ({ studentId: k.id, balanceAgorot: bal.get(k.id) ?? 0 })),
          t.amountAgorot,
        );
      }
      const { payment, receipt } = await recordPayment(tx, now, actor, {
        familyId,
        method: 'transfer',
        amountAgorot: t.amountAgorot,
        date: t.date,
        reference: [t.description, t.reference].filter(Boolean).join(' · '),
        parts,
        idempotencyKey: `bank:${t.id}`,
        source: 'bank',
        createdById: req.auth!.user.id,
      });
      if (pc) {
        await tx.planCharge.update({
          where: { id: pc.id },
          data: { status: 'paid', paymentId: payment.id, processingAt: null },
        });
        await topUpRecurring(tx, pc.planId);
        await refreshCompletion(tx, pc.planId);
      }
      await tx.bankTransaction.update({
        where: { id },
        data: {
          status: 'registered',
          familyId,
          paymentId: payment.id,
          decidedById: req.auth!.user.id,
          decidedAt: now,
        },
      });
      return { receiptId: receipt.id, receiptNumber: receipt.number, planCharge: !!pc };
    });
    await autoSendReceipt(deps, req.log, familyId, out.receiptId);
    return out;
  });

  app.post('/api/bank/transactions/:id/ignore', { config: { access: staff('bank') } }, async (req) => {
    const { id } = parse(idParam, req.params);
    return db.$transaction(async (tx) => {
      const t = await tx.bankTransaction.findUnique({ where: { id } });
      if (!t) throw notFound('התנועה לא נמצאה');
      if (t.status !== 'pending') throw conflict('התנועה כבר טופלה');
      await tx.bankTransaction.update({
        where: { id },
        data: { status: 'ignored', decidedById: req.auth!.user.id, decidedAt: clock.now() },
      });
      await recordAudit(tx, actorOf(req), clock.now(), {
        action: 'bank.ignore',
        summary: `סומנה תנועת בנק כלא רלוונטית (${formatMoney(t.amountAgorot)})`,
        entity: 'BankTransaction',
        entityId: id,
      });
      return { ok: true };
    });
  });

  // ---------- standing orders & Masav ----------
  app.get('/api/bank/standing-orders', { config: { access: staff('bank') } }, async () => {
    const plans = await db.billingPlan.findMany({
      where: { method: 'standing_order', status: 'active' },
      include: {
        student: { select: { fullName: true } },
        standingOrder: true,
        charges: {
          where: { status: { in: ['pending', 'expected', 'submitted', 'failed'] } },
          orderBy: { seq: 'asc' },
          take: 1,
        },
      },
    });
    const out: StandingOrderRow[] = plans.map((p) => ({
      planId: p.id,
      studentName: p.student.fullName,
      amountAgorot: p.charges[0]?.amountAgorot ?? p.amountAgorot,
      bank: p.standingOrder?.bank ?? '',
      branch: p.standingOrder?.branch ?? '',
      accountLast4: p.standingOrder?.accountLast4 ?? '',
      next: p.charges[0] ? { dueDate: p.charges[0].dueDate, status: p.charges[0].status } : null,
    }));
    return { standingOrders: out };
  });

  app.get('/api/bank/masav', { config: { access: staff('bank') } }, async () => {
    const exports = await db.masavExport.findMany({
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { items: true },
    });
    const pcs = await db.planCharge.findMany({
      where: { id: { in: exports.flatMap((e) => e.items.map((i) => i.planChargeId)) } },
      include: { plan: { include: { student: { select: { fullName: true } } } } },
    });
    const names = new Map(pcs.map((p) => [p.id, p.plan.student.fullName]));
    const out: MasavExportRow[] = exports.map((e) => ({
      id: e.id,
      createdAt: e.createdAt.toISOString(),
      chargeDate: e.chargeDate,
      count: e.count,
      totalAgorot: e.totalAgorot,
      status: e.status as MasavExportRow['status'],
      items: e.items.map((i) => ({
        id: i.id,
        studentName: names.get(i.planChargeId) ?? '',
        amountAgorot: i.amountAgorot,
        status: i.status as 'submitted',
        returnReason: i.returnReason,
      })),
    }));
    return { exports: out };
  });

  /** Standing-order installments due by the charge date go into one file and are marked "sent to the bank" (B5). */
  app.post('/api/bank/masav', { config: { access: staff('bank') } }, async (req) => {
    const { chargeDate } = parse(masavCreateSchema, req.body);
    const now = clock.now();
    return db.$transaction(async (tx) => {
      const due = await tx.planCharge.findMany({
        where: {
          status: { in: ['pending', 'expected'] },
          dueDate: { lte: chargeDate },
          plan: { status: 'active', method: 'standing_order' },
        },
        include: { plan: { include: { standingOrder: true, student: { select: { fullName: true } } } } },
        orderBy: [{ dueDate: 'asc' }, { seq: 'asc' }],
      });
      if (!due.length) throw badRequest('אין חיובי הוראת קבע לתאריך זה');
      const total = due.reduce((a, c) => a + c.amountAgorot, 0);
      const e = await tx.masavExport.create({
        data: {
          createdAt: now,
          createdById: req.auth!.user.id,
          chargeDate,
          count: due.length,
          totalAgorot: total,
          fileName: `masav-demo-${chargeDate}.txt`,
          sha256: '',
        },
      });
      for (const c of due) {
        await tx.masavExportItem.create({
          data: { exportId: e.id, planChargeId: c.id, amountAgorot: c.amountAgorot },
        });
        await tx.planCharge.update({
          where: { id: c.id },
          data: { status: 'submitted', processingAt: null },
        });
      }
      const content = masavFile(
        e,
        due.map((c) => ({
          amountAgorot: c.amountAgorot,
          bank: c.plan.standingOrder?.bank ?? '',
          branch: c.plan.standingOrder?.branch ?? '',
          account: c.plan.standingOrder ? deps.enc.decrypt(c.plan.standingOrder.accountEnc) : '',
          studentName: c.plan.student.fullName,
          ref: c.id,
        })),
      );
      await tx.masavExport.update({ where: { id: e.id }, data: { sha256: sha256(content) } });
      await recordAudit(tx, actorOf(req), now, {
        action: 'bank.masav',
        summary: `הופק קובץ מס״ב (הדגמה) לתאריך ${chargeDate}: ${due.length} הוראות, ${formatMoney(total)}`,
        entity: 'MasavExport',
        entityId: e.id,
      });
      return { id: e.id, count: due.length, totalAgorot: total };
    });
  });

  app.get('/api/bank/masav/:id/file', { config: { access: staff('bank') } }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const e = await db.masavExport.findUnique({
      where: { id },
      include: { items: { orderBy: { id: 'asc' } } },
    });
    if (!e) throw notFound('הקובץ לא נמצא');
    const pcs = await db.planCharge.findMany({
      where: { id: { in: e.items.map((i) => i.planChargeId) } },
      include: { plan: { include: { standingOrder: true, student: { select: { fullName: true } } } } },
      orderBy: [{ dueDate: 'asc' }, { seq: 'asc' }],
    });
    const byId = new Map(pcs.map((p) => [p.id, p]));
    const ordered = e.items
      .map((i) => byId.get(i.planChargeId)!)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.seq - b.seq);
    const content = masavFile(
      e,
      ordered.map((c) => ({
        amountAgorot: c.amountAgorot,
        bank: c.plan.standingOrder?.bank ?? '',
        branch: c.plan.standingOrder?.branch ?? '',
        account: c.plan.standingOrder ? deps.enc.decrypt(c.plan.standingOrder.accountEnc) : '',
        studentName: c.plan.student.fullName,
        ref: c.id,
      })),
    );
    await db.$transaction((tx) =>
      recordAudit(tx, actorOf(req), clock.now(), {
        action: 'bank.masav_download',
        summary: `הורד קובץ מס״ב ${e.chargeDate}`,
        entity: 'MasavExport',
        entityId: id,
      }),
    );
    return reply
      .header('content-type', 'text/plain; charset=utf-8')
      .header('content-disposition', `attachment; filename="${e.fileName}"`)
      .send(content);
  });

  /** After the charge date: everything not returned is recorded as paid by standing order. */
  app.post('/api/bank/masav/:id/settle', { config: { access: staff('bank') } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const now = clock.now();
    const actor = actorOf(req);
    return db.$transaction(async (tx) => {
      const e = await tx.masavExport.findUnique({ where: { id }, include: { items: true } });
      if (!e) throw notFound('הקובץ לא נמצא');
      if (e.status !== 'submitted') throw conflict('הקובץ כבר אושר');
      if (e.chargeDate > todayOf(deps)) throw conflict('אפשר לאשר רק אחרי תאריך החיוב');
      let paid = 0;
      for (const item of e.items.filter((i) => i.status === 'submitted')) {
        const pc = await tx.planCharge.findUniqueOrThrow({
          where: { id: item.planChargeId },
          include: { plan: { include: { student: true, standingOrder: true } } },
        });
        const { payment } = await recordPayment(tx, now, actor, {
          familyId: pc.plan.student.familyId,
          method: 'standing_order',
          amountAgorot: item.amountAgorot,
          date: e.chargeDate,
          reference: `הוראת קבע ${pc.plan.standingOrder?.bank ?? ''} ****${pc.plan.standingOrder?.accountLast4 ?? ''}`,
          parts: [{ studentId: pc.plan.studentId, amountAgorot: item.amountAgorot }],
          idempotencyKey: `masav:${item.id}`,
          source: 'bank',
          createdById: req.auth!.user.id,
        });
        await tx.masavExportItem.update({
          where: { id: item.id },
          data: { status: 'paid', paymentId: payment.id },
        });
        await tx.planCharge.update({ where: { id: pc.id }, data: { status: 'paid', paymentId: payment.id } });
        await topUpRecurring(tx, pc.planId);
        await refreshCompletion(tx, pc.planId);
        paid++;
      }
      await tx.masavExport.update({ where: { id }, data: { status: 'settled', settledAt: now } });
      await recordAudit(tx, actor, now, {
        action: 'bank.masav_settle',
        summary: `אושר ביצוע קובץ מס״ב ${e.chargeDate}: ${paid} תשלומים נרשמו`,
        entity: 'MasavExport',
        entityId: id,
      });
      return { paid };
    });
  });

  /** A returned standing-order charge: the installment fails; if it was already recorded as paid, it is reversed. */
  app.post('/api/bank/masav/items/:id/return', { config: { access: staff('bank') } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { reason } = parse(masavReturnSchema, req.body);
    const now = clock.now();
    const actor = actorOf(req);
    return db.$transaction(async (tx) => {
      const item = await tx.masavExportItem.findUnique({ where: { id } });
      if (!item) throw notFound('השורה לא נמצאה');
      if (item.status === 'returned') throw conflict('השורה כבר סומנה כמוחזרת');
      if (item.status === 'paid' && item.paymentId) {
        await reversePayment(tx, now, actor, {
          paymentId: item.paymentId,
          reason: `הוראת קבע הוחזרה: ${reason}`,
          date: todayOf(deps),
          createdById: req.auth!.user.id,
        });
        // The paid row becomes "returned" (its payment link stays); a replacement installment carries the debt.
        const pc = await tx.planCharge.findUniqueOrThrow({ where: { id: item.planChargeId } });
        await tx.planCharge.update({
          where: { id: pc.id },
          data: { status: 'returned', lastError: `הוראת קבע הוחזרה: ${reason}` },
        });
        const last = await tx.planCharge.findFirst({
          where: { planId: pc.planId },
          orderBy: { seq: 'desc' },
        });
        await tx.planCharge.create({
          data: {
            planId: pc.planId,
            seq: (last?.seq ?? 0) + 1,
            dueDate: pc.dueDate,
            amountAgorot: pc.amountAgorot,
            status: 'failed',
            lastError: `הוראת קבע הוחזרה: ${reason}`,
          },
        });
        await tx.billingPlan.updateMany({
          where: { id: pc.planId, status: 'completed' },
          data: { status: 'active' },
        });
      } else {
        await tx.planCharge.update({
          where: { id: item.planChargeId },
          data: { status: 'failed', lastError: `הוראת קבע הוחזרה: ${reason}` },
        });
      }
      await tx.masavExportItem.update({ where: { id }, data: { status: 'returned', returnReason: reason } });
      await recordAudit(tx, actor, now, {
        action: 'bank.masav_return',
        summary: `הוראת קבע הוחזרה (${formatMoney(item.amountAgorot)}): ${reason}`,
        entity: 'MasavExportItem',
        entityId: id,
      });
      return { ok: true };
    });
  });
}
