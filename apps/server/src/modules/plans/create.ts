import {
  CONSENT_METHODS,
  PLAN_METHODS,
  consentText,
  formatMoney,
  type ConsentMethod,
  type PlanInput,
  type PlanMethod,
} from '@tuition/shared';
import type { Deps } from '../../deps';
import type { Db, Tx } from '../../lib/db';
import { badRequest, notFound } from '../../lib/errors';
import { buildSchedule, planLabel } from '../../domain/schedule';
import { recordAudit, type Actor } from '../audit/service';

export async function validatePlan(db: Db | Tx, input: PlanInput) {
  const s = await db.student.findFirst({
    where: { id: input.studentId, deletedAt: null },
    include: { family: true },
  });
  if (!s) throw notFound('התלמיד לא נמצא');
  if (input.method === 'card') {
    // Demo: only the student's own saved cards.
    const c = await db.savedCard.findFirst({
      where: { id: input.cardId, studentId: s.id, removedAt: null },
    });
    if (!c)
      throw badRequest('לתלמיד אין כרטיס שמור כזה. הוסף כרטיס בכרטיס התלמיד או במסך כרטיסים שמורים', {
        cardId: 'כרטיס לא נמצא',
      });
  }
  let schedule;
  try {
    schedule = buildSchedule(input.type, input.amountAgorot, input.count, input.startDate);
  } catch (e) {
    if (e instanceof RangeError) throw badRequest(e.message);
    throw e;
  }
  return { student: s, schedule };
}

export const consentFor = (input: PlanInput, payer: string) =>
  consentText({
    payer,
    method:
      input.method === 'card'
        ? 'חיוב כרטיס אשראי'
        : input.method === 'standing_order'
          ? 'חיוב בהוראת קבע'
          : 'תשלום בהעברה',
    label: planLabel(input.type, input.count, input.count),
    amount:
      input.type === 'installments'
        ? `${formatMoney(input.amountAgorot)} סה״כ`
        : `${formatMoney(input.amountAgorot)} לחודש`,
  });

/**
 * Creates a plan with its schedule inside the caller's transaction. Used by the plans screen
 * and by approval of a parent's installments request. Returns the plan id.
 */
export async function createPlan(
  deps: Deps,
  tx: Tx,
  input: PlanInput,
  o: {
    idempotencyKey: string;
    consentMethod: ConsentMethod | null;
    actor: Actor;
    now: Date;
    /** Staff member who creates the plan and records the consent. */
    userId: string;
  },
): Promise<string> {
  const { student, schedule } = await validatePlan(tx, input);
  const consent = o.consentMethod;
  let standingOrderId: string | null = null;
  if (input.method === 'standing_order') {
    const so = await tx.standingOrder.create({
      data: {
        studentId: student.id,
        bank: input.standingOrder!.bank,
        branch: input.standingOrder!.branch,
        accountEnc: deps.enc.encrypt(input.standingOrder!.account),
        accountLast4: input.standingOrder!.account.slice(-4),
      },
    });
    standingOrderId = so.id;
  }
  const p = await tx.billingPlan.create({
    data: {
      studentId: student.id,
      type: input.type,
      amountAgorot: input.amountAgorot,
      count: input.count,
      method: input.method,
      cardId: input.method === 'card' ? input.cardId! : null,
      standingOrderId,
      startDate: input.startDate,
      dayOfMonth: Number(input.startDate.slice(8, 10)),
      consentMethod: consent ? CONSENT_METHODS[consent] : null,
      consentText: consent ? consentFor(input, student.family.parentName) : null,
      consentAt: consent ? o.now : null,
      consentById: consent ? o.userId : null,
      idempotencyKey: o.idempotencyKey,
      createdById: o.userId,
      charges: {
        create: schedule.map((c) => ({ seq: c.seq, dueDate: c.dueDate, amountAgorot: c.amountAgorot })),
      },
    },
  });
  await recordAudit(tx, o.actor, o.now, {
    action: 'plan.create',
    summary: `נוצרה תוכנית: ${planLabel(p.type, p.count, schedule.length)} ל${student.fullName} (${PLAN_METHODS[p.method as PlanMethod]})`,
    entity: 'BillingPlan',
    entityId: p.id,
    after: { ...p, idempotencyKey: o.idempotencyKey, firstCharges: schedule.slice(0, 3) },
  });
  return p.id;
}
