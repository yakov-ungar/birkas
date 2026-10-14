/** A card is valid through the last day of its expiry month. */
export function isExpiredOn(expMonth: number, expYear: number, date: string): boolean {
  const [y, m] = date.split('-').map(Number) as [number, number];
  return expYear < y || (expYear === y && expMonth < m);
}

/** Days until the card stops working (first day after its expiry month). */
export function daysLeft(expMonth: number, expYear: number, today: string): number {
  const end = Date.UTC(expYear, expMonth, 1);
  return Math.round((end - Date.parse(today)) / 86_400_000);
}

import type { Db, Tx } from '../../lib/db';

/** Active (or paused) plans with installments still to charge, per card. Such a card cannot be removed. */
export async function linkedPlanCounts(db: Db | Tx, cardIds: string[]): Promise<Map<string, number>> {
  const plans = await db.billingPlan.findMany({
    where: {
      cardId: { in: cardIds },
      status: { in: ['active', 'paused'] },
      charges: { some: { status: { in: ['pending', 'failed', 'processing'] } } },
    },
    select: { cardId: true },
  });
  const m = new Map<string, number>();
  for (const p of plans) m.set(p.cardId!, (m.get(p.cardId!) ?? 0) + 1);
  return m;
}
