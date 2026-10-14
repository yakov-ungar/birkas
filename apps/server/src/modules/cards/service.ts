import type { Deps } from '../../deps';
import { israelDate } from '../../lib/clock';
import { badRequest } from '../../lib/errors';
import { ProviderError, type TokenizationResult } from '../../providers/payment/types';
import { recordAudit, type Actor } from '../audit/service';
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

/** Saves a card from the provider's hosted fields without charging it (staff screen and parent portal). */
export async function saveCard(deps: Deps, o: { studentId: string; card: TokenizationResult; actor: Actor }) {
  let t;
  try {
    t = await deps.payments.finalizeTokenization(o.card);
  } catch (e) {
    if (e instanceof ProviderError) throw badRequest(e.message);
    throw e;
  }
  const now = deps.clock.now();
  if (isExpiredOn(t.expMonth, t.expYear, israelDate(now))) throw badRequest('הכרטיס פג תוקף');
  return deps.db.$transaction(async (tx) => {
    const s = await tx.student.findFirstOrThrow({ where: { id: o.studentId } });
    const hasDefault = await tx.savedCard.count({
      where: { studentId: o.studentId, removedAt: null, isDefault: true },
    });
    const c = await tx.savedCard.create({
      data: {
        studentId: o.studentId,
        provider: deps.payments.name,
        tokenEnc: deps.enc.encrypt(t.token),
        last4: t.last4,
        brand: t.brand,
        expMonth: t.expMonth,
        expYear: t.expYear,
        holderName: t.holderName,
        isDefault: hasDefault === 0,
      },
    });
    await recordAudit(tx, o.actor, now, {
      action: 'card.save',
      summary: `נשמר כרטיס ****${c.last4} לתלמיד ${s.fullName}`,
      entity: 'SavedCard',
      entityId: c.id,
      after: { ...c, tokenEnc: undefined },
    });
    return c;
  });
}
