import { formatMoney, percentOf, type DISCOUNT_REASONS } from '@tuition/shared';
import type { Tx } from '../../lib/db';
import { badRequest, notFound } from '../../lib/errors';
import { recordAudit, type Actor } from '../audit/service';
import { addCharge } from './charges';
import { tuitionOf } from './money';

export interface DiscountInput {
  studentId: string;
  kind: 'pct' | 'amount';
  /** Percent (up to 2 decimals) when kind=pct; agorot when kind=amount. */
  value: number;
  reason: (typeof DISCOUNT_REASONS)[number];
  note?: string | null;
}

/** Adds a discount line on the student's tuition for the active year. Used by staff and by request approval. */
export async function createDiscount(
  tx: Tx,
  input: DiscountInput,
  o: { actor: Actor; now: Date; today: string; yearName: string; createdById: string | null },
) {
  const s = await tx.student.findFirst({ where: { id: input.studentId, deletedAt: null } });
  if (!s) throw notFound('התלמיד לא נמצא');
  const tuition = await tuitionOf(tx, s.id, o.yearName);
  if (tuition <= 0) throw badRequest(`ל${s.fullName} אין שכר לימוד לשנה הנוכחית`);
  let amount: number;
  if (input.kind === 'pct') {
    if (input.value > 100) throw badRequest('אחוז הנחה עד 100', { value: 'אחוז הנחה עד 100' });
    if (Math.round(input.value * 100) !== input.value * 100) throw badRequest('עד שתי ספרות אחרי הנקודה');
    amount = percentOf(tuition, input.value);
  } else {
    if (!Number.isSafeInteger(input.value)) throw badRequest('סכום לא תקין');
    amount = input.value;
  }
  if (amount <= 0) throw badRequest('ההנחה יוצאת אפס אחרי עיגול');
  if (amount > tuition) throw badRequest('ההנחה גדולה משכר הלימוד', { value: 'ההנחה גדולה משכר הלימוד' });
  // The internal note is kept apart from the description, which parents see on statements.
  const description = `${input.reason}${input.kind === 'pct' ? ` (${input.value}%)` : ''}`;
  const c = await addCharge(tx, {
    studentId: s.id,
    type: 'disc',
    description,
    amountAgorot: -amount,
    date: o.today,
    yearName: o.yearName,
    reason: input.reason,
    internalNote: input.note || null,
    createdById: o.createdById,
  });
  await recordAudit(tx, o.actor, o.now, {
    action: 'charge.discount',
    summary: `הנחה ${formatMoney(amount)} ל${s.fullName}: ${input.reason}`,
    entity: 'Charge',
    entityId: c.id,
    after: c,
  });
  return { chargeId: c.id, amountAgorot: amount, studentName: s.fullName };
}
