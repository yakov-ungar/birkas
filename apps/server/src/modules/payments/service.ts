import { PAYMENT_METHODS, formatMoney, type PaymentMethod, type PaymentResult } from '@tuition/shared';
import type { Payment, Receipt } from '@prisma/client';
import type { Tx } from '../../lib/db';
import { recordAudit, type Actor } from '../audit/service';
import { issueDocument, toRow } from '../receipts/service';
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
