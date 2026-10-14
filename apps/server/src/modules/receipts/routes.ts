import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DOC_TYPES, emailSchema, formatMoney, reasonSchema, type DocType } from '@tuition/shared';
import { staff } from '../../plugins/access';
import { actorOf } from '../../plugins/auth';
import { AppError, conflict, notFound, parse } from '../../lib/errors';
import { recordAudit } from '../audit/service';
import { todayOf } from '../finance/context';
import { resultOf } from '../payments/service';
import { documentPdf, emailDocument, issueDocument, receiptView, toRow } from './service';

const idParam = z.object({ id: z.string().min(1).max(40) });

export async function receiptRoutes(app: FastifyInstance) {
  const deps = app.deps;
  const { db, clock } = deps;

  app.get('/api/receipts', { config: { access: staff('rec') } }, async (req) => {
    const { q, limit } = parse(
      z.object({
        q: z.string().trim().max(60).optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      }),
      req.query,
    );
    const num = q && /^\d+$/.test(q) ? Number(q) : null;
    const rows = await db.receipt.findMany({
      where: q ? (num ? { number: num } : { payerName: { contains: q } }) : {},
      include: { creditFor: true, creditedBy: true },
      orderBy: { issuedAt: 'desc' },
      take: limit,
    });
    return { receipts: rows.map(toRow) };
  });

  app.get('/api/receipts/:id', { config: { access: staff(['rec', 'pay']) } }, async (req) => {
    const { id } = parse(idParam, req.params);
    return receiptView(db, id);
  });

  app.get('/api/receipts/:id/pdf', { config: { access: staff(['rec', 'pay']) } }, async (req, reply) => {
    const { id } = parse(idParam, req.params);
    const { pdf, filename } = await documentPdf(db, id);
    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename="${filename}"`)
      .send(pdf);
  });

  app.post('/api/receipts/:id/email', { config: { access: staff('rec') } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { email } = parse(emailSchema, req.body);
    const r = await db.receipt.findUnique({ where: { id } });
    if (!r) throw notFound('המסמך לא נמצא');
    await emailDocument(deps, id, email);
    await db.$transaction((tx) =>
      recordAudit(tx, actorOf(req), clock.now(), {
        action: 'receipt.email',
        summary: `${DOC_TYPES[r.docType as DocType]} ${r.number} נשלח במייל`,
        entity: 'Receipt',
        entityId: id,
      }),
    );
    return { ok: true };
  });

  /**
   * Cancels a receipt with a credit note (own numbering, A3). The receipt itself never changes.
   * A card payment is refunded through the provider first (A8).
   */
  app.post('/api/receipts/:id/cancel', { config: { access: staff('pay') } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { reason } = parse(reasonSchema, req.body);
    const now = clock.now();
    const today = todayOf(deps);
    const actor = actorOf(req);
    const r = await db.receipt.findUnique({
      where: { id },
      include: { creditedBy: true, payment: { include: { allocations: true } } },
    });
    if (!r) throw notFound('הקבלה לא נמצאה');
    if (r.docType !== 'receipt') throw conflict('ניתן לבטל קבלה בלבד');
    if (r.creditedBy) throw conflict('הקבלה כבר בוטלה');
    if (r.payment.method === 'check') throw conflict('קבלה על שיק מבוטלת דרך מסך השיקים (שיק חוזר)');

    if (r.payment.method === 'card' && r.payment.cardTxnId) {
      const charge = await db.cardTransaction.findUniqueOrThrow({ where: { id: r.payment.cardTxnId } });
      const key = `refund:${r.id}`;
      const refundTxn =
        (await db.cardTransaction.findUnique({ where: { idempotencyKey: key } })) ??
        (await db.cardTransaction.create({
          data: {
            idempotencyKey: key,
            kind: 'refund',
            familyId: r.familyId,
            amountAgorot: r.amountAgorot,
            last4: charge.last4,
            status: 'pending',
            refundOfId: charge.id,
          },
        }));
      if (refundTxn.status !== 'approved') {
        const res = await deps.payments.refund({
          providerTxnId: charge.providerTxnId ?? '',
          amountAgorot: r.amountAgorot,
          idempotencyKey: key,
        });
        if (res.status !== 'approved') {
          if (refundTxn.status === 'pending')
            await db.cardTransaction.update({
              where: { id: refundTxn.id },
              data: { status: res.status, errorMessageHe: res.errorMessageHe },
            });
          throw new AppError(402, 'refund_failed', `הזיכוי בחברת האשראי נכשל: ${res.errorMessageHe}`);
        }
        await db.cardTransaction.update({
          where: { id: refundTxn.id },
          data: { status: 'approved', providerTxnId: res.providerTxnId },
        });
      }
    }

    return db.$transaction(async (tx) => {
      const reversal = await tx.payment.create({
        data: {
          familyId: r.familyId,
          method: r.payment.method,
          amountAgorot: -r.payment.amountAgorot,
          date: today,
          reference: `ביטול קבלה ${r.number}`,
          kind: 'reversal',
          reversalOfId: r.paymentId,
          idempotencyKey: `reversal:${r.paymentId}`,
          source: 'staff',
          createdById: req.auth!.user.id,
          allocations: {
            create: r.payment.allocations.map((a) => ({
              studentId: a.studentId,
              amountAgorot: -a.amountAgorot,
            })),
          },
        },
      });
      const note = await issueDocument(tx, now, {
        docType: 'credit_note',
        paymentId: reversal.id,
        familyId: r.familyId,
        date: today,
        payerName: r.payerName,
        amountAgorot: r.amountAgorot,
        method: r.method,
        reference: reason,
        lines: r.payment.allocations.map((a) => ({ studentId: a.studentId, amountAgorot: a.amountAgorot })),
        creditForReceiptId: r.id,
        reason,
      });
      await recordAudit(tx, actor, now, {
        action: 'receipt.cancel',
        summary: `בוטלה קבלה ${r.number} (${formatMoney(r.amountAgorot)}): ${reason}. אישור זיכוי ${note.number}`,
        entity: 'Receipt',
        entityId: r.id,
        after: { creditNoteNumber: note.number, reason },
      });
      return resultOf(tx, reversal.id);
    });
  });
}
