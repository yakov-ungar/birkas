import type { FastifyBaseLogger } from 'fastify';
import type { PaymentResult } from '@tuition/shared';
import type { Deps } from '../../deps';
import { israelDate } from '../../lib/clock';
import { AppError, badRequest, conflict, notFound } from '../../lib/errors';
import { recordAudit, type Actor } from '../audit/service';
import { isExpiredOn } from '../cards/service';
import { ProviderError } from '../../providers/payment/types';
import type { Part } from '../../domain/allocate';
import { autoSendReceipt, recordPayment, resultOf } from './service';

const paymentDeclined = (msg: string) => new AppError(402, 'payment_declined', msg);

export interface CardPayment {
  familyId: string;
  parts: Part[];
  amountAgorot: number;
  idempotencyKey: string;
  cardId?: string;
  newCard?: {
    token: string;
    last4: string;
    brand: string;
    expMonth: number;
    expYear: number;
    holderName: string;
    save: boolean;
  };
  actor: Actor;
  source: 'staff' | 'portal';
  createdById: string | null;
}

/**
 * Card payment used by staff and by the parent portal: the provider is called with an
 * idempotency key, the attempt is recorded before the call, and on approval the payment,
 * allocations and receipt are written in one transaction.
 */
export async function payByCard(deps: Deps, log: FastifyBaseLogger, p: CardPayment): Promise<PaymentResult> {
  const { db, clock } = deps;
  const now = clock.now();
  const today = israelDate(now);
  const { familyId, parts, actor } = p;
  if (!!p.cardId === !!p.newCard) throw badRequest('יש לבחור כרטיס שמור או להזין כרטיס חדש');
  let token: string;
  let last4: string;
  let cardId: string | null = null;
  let newCardToSave: {
    token: string;
    last4: string;
    brand: string;
    expMonth: number;
    expYear: number;
    holderName: string;
  } | null = null;
  if (p.cardId) {
    const c = await db.savedCard.findFirst({
      where: { id: p.cardId, removedAt: null, student: { familyId } },
    });
    if (!c) throw notFound('הכרטיס לא נמצא');
    if (isExpiredOn(c.expMonth, c.expYear, today)) throw badRequest('הכרטיס פג תוקף, בחר כרטיס אחר');
    token = deps.enc.decrypt(c.tokenEnc);
    last4 = c.last4;
    cardId = c.id;
  } else {
    let t;
    try {
      t = await deps.payments.finalizeTokenization(p.newCard!);
    } catch (e) {
      if (e instanceof ProviderError) throw badRequest(e.message);
      throw e;
    }
    if (isExpiredOn(t.expMonth, t.expYear, today)) throw badRequest('הכרטיס פג תוקף');
    token = t.token;
    last4 = t.last4;
    if (p.newCard!.save) newCardToSave = t;
  }

  // Written before calling the provider, so a crash mid-call leaves a trace to reconcile.
  const prior = await db.cardTransaction.findUnique({ where: { idempotencyKey: p.idempotencyKey } });
  if (prior && prior.familyId !== familyId) throw conflict('מזהה העסקה כבר בשימוש');
  if (prior && prior.status === 'pending') throw conflict('העסקה עדיין בטיפול. בדקו שוב בעוד רגע');
  if (prior && prior.status !== 'approved') throw paymentDeclined(prior.errorMessageHe ?? 'החיוב נכשל');
  const txn =
    prior ??
    (await db.cardTransaction.create({
      data: {
        idempotencyKey: p.idempotencyKey,
        kind: 'charge',
        familyId,
        amountAgorot: p.amountAgorot,
        cardId,
        last4,
        status: 'pending',
      },
    }));

  const r = await deps.payments.chargeToken({
    token,
    amountAgorot: p.amountAgorot,
    idempotencyKey: p.idempotencyKey,
    description: 'שכר לימוד',
  });
  if (r.status !== 'approved') {
    await db.cardTransaction.update({
      where: { id: txn.id },
      data: { status: r.status, errorMessageHe: r.errorMessageHe },
    });
    await db.$transaction((tx) =>
      recordAudit(tx, actor, now, {
        action: 'payment.card_failed',
        summary: `חיוב אשראי נכשל ****${last4}: ${r.errorMessageHe}`,
        entity: 'CardTransaction',
        entityId: txn.id,
      }),
    );
    throw paymentDeclined(r.errorMessageHe);
  }

  const result = await db.$transaction(async (tx) => {
    await tx.cardTransaction.update({
      where: { id: txn.id },
      data: { status: 'approved', providerTxnId: r.providerTxnId, approvalCode: r.approvalCode },
    });
    if (newCardToSave) {
      // Saved with the student who receives the largest share (demo: the first part).
      const studentId = parts[0]!.studentId;
      const hasDefault = await tx.savedCard.count({
        where: { studentId, removedAt: null, isDefault: true },
      });
      const saved = await tx.savedCard.create({
        data: {
          studentId,
          provider: deps.payments.name,
          tokenEnc: deps.enc.encrypt(newCardToSave.token),
          last4: newCardToSave.last4,
          brand: newCardToSave.brand,
          expMonth: newCardToSave.expMonth,
          expYear: newCardToSave.expYear,
          holderName: newCardToSave.holderName,
          isDefault: hasDefault === 0,
        },
      });
      await recordAudit(tx, actor, now, {
        action: 'card.save',
        summary: `נשמר כרטיס ****${saved.last4}`,
        entity: 'SavedCard',
        entityId: saved.id,
        after: { ...saved, tokenEnc: undefined },
      });
    }
    const { payment } = await recordPayment(tx, now, actor, {
      familyId,
      method: 'card',
      amountAgorot: p.amountAgorot,
      date: today,
      reference: `${cardId ? 'כרטיס שמור' : 'כרטיס'} ****${last4}`,
      parts,
      idempotencyKey: p.idempotencyKey,
      source: p.source,
      cardTxnId: txn.id,
      createdById: p.createdById,
    });
    return resultOf(tx, payment.id, { approvalCode: r.approvalCode });
  });
  if (result.receipt) await autoSendReceipt(deps, log, familyId, result.receipt.id);
  return result;
}
