import { PAYMENT_METHODS, formatMoney, type PaymentMethod, type PaymentResult } from '@tuition/shared';
import type { FastifyBaseLogger } from 'fastify';
import { AppError } from '../../lib/errors';
import type { Deps } from '../../deps';
import type { Payment, Receipt } from '@prisma/client';
import type { Tx } from '../../lib/db';
import { recordAudit, type Actor } from '../audit/service';
import { emailDocument, issueDocument, toRow } from '../receipts/service';
import type { Part } from '../../domain/allocate';

export interface NewPayment {
  familyId: string;
  method: PaymentMethod;
  amountAgorot: number;
  date: string;
  reference: string;
  parts: Part[];
  idempotencyKey: string;
  source: 'staff' | 'portal' | 'scheduler' | 'bank' | 'check';
  cardTxnId?: string | null;
  checkId?: string | null;
  createdById: string | null;
}

/**
 * Records money received: payment, per-student allocations and a numbered receipt, in the
 * caller's transaction. Every way money comes in (staff, portal, scheduler, bank, checks) goes through here.
 */
export async function recordPayment(
  tx: Tx,
  now: Date,
  actor: Actor,
  p: NewPayment,
): Promise<{ payment: Payment; receipt: Receipt }> {
  const sum = p.parts.reduce((s, x) => s + x.amountAgorot, 0);
  if (sum !== p.amountAgorot) throw new Error('allocation does not add up');
  const family = await tx.family.findUniqueOrThrow({ where: { id: p.familyId } });
  const cashSessionId = p.method === 'cash' ? await openCashSessionId(tx) : null;
  const payment = await tx.payment.create({
    data: {
      familyId: p.familyId,
      method: p.method,
      amountAgorot: p.amountAgorot,
      date: p.date,
      reference: p.reference,
      kind: 'payment',
      idempotencyKey: p.idempotencyKey,
      source: p.source,
      cardTxnId: p.cardTxnId ?? null,
      checkId: p.checkId ?? null,
      cashSessionId,
      createdById: p.createdById,
      allocations: {
        create: p.parts
          .filter((x) => x.amountAgorot > 0)
          .map((x) => ({ studentId: x.studentId, amountAgorot: x.amountAgorot })),
      },
    },
  });
  const receipt = await issueDocument(tx, now, {
    docType: 'receipt',
    paymentId: payment.id,
    familyId: p.familyId,
    date: p.date,
    payerName: family.parentName,
    amountAgorot: p.amountAgorot,
    method: p.method,
    reference: p.reference,
    lines: p.parts,
  });
  await recordAudit(tx, actor, now, {
    action: 'payment.create',
    summary: `${PAYMENT_METHODS[p.method]}: ${family.name} ${formatMoney(p.amountAgorot)} (קבלה ${receipt.number})`,
    entity: 'Payment',
    entityId: payment.id,
    after: { ...payment, parts: p.parts, receiptNumber: receipt.number },
  });
  return { payment, receipt };
}

export async function resultOf(
  tx: Tx,
  paymentId: string,
  extra: Partial<PaymentResult> = {},
): Promise<PaymentResult> {
  const p = await tx.payment.findUniqueOrThrow({
    where: { id: paymentId },
    include: {
      allocations: { include: { student: { select: { fullName: true } } } },
      receipt: { include: { creditFor: true, creditedBy: true } },
    },
  });
  return {
    paymentId: p.id,
    receipt: p.receipt ? toRow(p.receipt) : null,
    allocations: p.allocations.map((a) => ({
      studentId: a.studentId,
      studentName: a.student.fullName,
      amountAgorot: a.amountAgorot,
    })),
    ...extra,
  };
}

/** Cash goes into (or out of) the open drawer; without one, cash cannot be handled (decision B9). */
export async function openCashSessionId(tx: Tx): Promise<string> {
  const s = await tx.cashSession.findFirst({ where: { closedAt: null }, select: { id: true } });
  if (!s)
    throw new AppError(
      409,
      'cash_closed',
      'הקופה סגורה. יש לפתוח קופה (במסך שיקים וקופה) לפני קבלה או החזרה של מזומן',
    );
  return s.id;
}

/**
 * Reverses a received payment: an opposite payment with negated allocations and a credit note
 * (own numbering, A3) pointing to the original receipt, which itself never changes.
 * Used for receipt cancellation and for bounced checks (B4).
 */
export async function reversePayment(
  tx: Tx,
  now: Date,
  actor: Actor,
  input: { paymentId: string; reason: string; date: string; createdById: string | null; reference?: string },
) {
  const r = await tx.receipt.findUniqueOrThrow({
    where: { paymentId: input.paymentId },
    include: { creditedBy: true, payment: { include: { allocations: true } } },
  });
  if (r.creditedBy) throw new AppError(409, 'conflict', 'הקבלה כבר בוטלה');
  const reversal = await tx.payment.create({
    data: {
      familyId: r.familyId,
      method: r.payment.method,
      amountAgorot: -r.payment.amountAgorot,
      date: input.date,
      reference: input.reference ?? `ביטול קבלה ${r.number}`,
      kind: 'reversal',
      reversalOfId: r.paymentId,
      idempotencyKey: `reversal:${r.paymentId}`,
      source: 'staff',
      cashSessionId: r.payment.method === 'cash' ? await openCashSessionId(tx) : null,
      createdById: input.createdById,
      allocations: {
        create: r.payment.allocations.map((a) => ({ studentId: a.studentId, amountAgorot: -a.amountAgorot })),
      },
    },
  });
  const note = await issueDocument(tx, now, {
    docType: 'credit_note',
    paymentId: reversal.id,
    familyId: r.familyId,
    date: input.date,
    payerName: r.payerName,
    amountAgorot: r.amountAgorot,
    method: r.method,
    reference: input.reason,
    lines: r.payment.allocations.map((a) => ({ studentId: a.studentId, amountAgorot: a.amountAgorot })),
    creditForReceiptId: r.id,
    reason: input.reason,
  });
  await recordAudit(tx, actor, now, {
    action: 'receipt.cancel',
    summary: `בוטלה קבלה ${r.number} (${formatMoney(r.amountAgorot)}): ${input.reason}. אישור זיכוי ${note.number}`,
    entity: 'Receipt',
    entityId: r.id,
    after: { creditNoteNumber: note.number, reason: input.reason },
  });
  return { reversal, note, receipt: r };
}

/** Rule 4 of the demo ("שליחת קבלה אוטומטית"), wired to the reminder rules in stage 5. */
export async function autoSendReceipt(
  deps: Deps,
  log: FastifyBaseLogger,
  familyId: string,
  receiptId: string,
) {
  const f = await deps.db.family.findUnique({ where: { id: familyId } });
  if (!f?.email) return;
  try {
    await emailDocument(deps, receiptId, f.email);
  } catch (e) {
    log.warn({ err: e, receiptId }, 'auto receipt email failed');
  }
}
