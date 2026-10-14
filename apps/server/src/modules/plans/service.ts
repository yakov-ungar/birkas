import {
  PLAN_METHODS,
  formatMoney,
  type PlanMethod,
  type PlanRow,
  type PlanStatus,
  type RunSummary,
} from '@tuition/shared';
import type { BillingPlan, PlanCharge, Prisma } from '@prisma/client';
import type { Db, Tx } from '../../lib/db';
import type { Deps } from '../../deps';
import { israelDate } from '../../lib/clock';
import { recordAudit, SYSTEM_ACTOR, type Actor } from '../audit/service';
import { recordPayment } from '../payments/service';
import { isExpiredOn } from '../cards/service';
import { ROLLING_AHEAD, monthlyDate, planLabel } from '../../domain/schedule';

type PlanWithCharges = BillingPlan & { charges: PlanCharge[]; student: { fullName: string } };

/** A processing row older than this is treated as interrupted and re-sent with the same key. */
const STALE_MS = 10 * 60_000;

export function displayStatus(
  p: Pick<BillingPlan, 'status'> & { charges: Pick<PlanCharge, 'status'>[] },
): [string, string] {
  if (p.status === 'cancelled') return ['בוטלה', 'gr'];
  if (p.charges.every((c) => c.status === 'paid' || c.status === 'cancelled')) return ['הסתיימה', 'g'];
  if (p.charges.some((c) => c.status === 'failed')) return ['נכשל חיוב', 'r'];
  return p.status === 'active' ? ['פעילה', 'g'] : ['מושבתת', 'o'];
}

export function toPlanRow(p: PlanWithCharges): PlanRow {
  const next = p.charges.find((c) => c.status === 'pending' || c.status === 'failed');
  return {
    id: p.id,
    studentId: p.studentId,
    studentName: p.student.fullName,
    type: p.type as PlanRow['type'],
    label: planLabel(p.type, p.count, p.charges.length),
    amountAgorot: p.amountAgorot,
    count: p.count,
    paidCount: p.charges.filter((c) => c.status === 'paid').length,
    totalCount: p.charges.length,
    method: p.method as PlanMethod,
    methodLabel: p.method === 'card' ? 'אשראי' : PLAN_METHODS[p.method as PlanMethod],
    next: next && p.status === 'active' ? { dueDate: next.dueDate, amountAgorot: next.amountAgorot } : null,
    status: p.status as PlanStatus,
    display: displayStatus(p),
  };
}

export async function planRows(db: Db | Tx, where: Prisma.BillingPlanWhereInput = {}): Promise<PlanRow[]> {
  const plans = await db.billingPlan.findMany({
    where,
    include: { charges: { orderBy: { seq: 'asc' } }, student: { select: { fullName: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return plans.map(toPlanRow);
}

/** Open-ended recurring plans always keep ROLLING_AHEAD future charges (decision C10). */
export async function topUpRecurring(tx: Tx, planId: string) {
  const p = await tx.billingPlan.findUniqueOrThrow({
    where: { id: planId },
    include: { charges: { orderBy: { seq: 'asc' } } },
  });
  if (p.type !== 'recurring' || p.count !== 0 || p.status === 'cancelled') return;
  const future = p.charges.filter((c) => c.status === 'pending').length;
  let seq = p.charges.at(-1)?.seq ?? 0;
  for (let i = future; i < ROLLING_AHEAD; i++) {
    seq++;
    await tx.planCharge.create({
      data: {
        planId,
        seq,
        dueDate: monthlyDate(p.startDate, seq - 1, p.dayOfMonth),
        amountAgorot: p.amountAgorot,
      },
    });
  }
}

export async function refreshCompletion(tx: Tx, planId: string) {
  const p = await tx.billingPlan.findUniqueOrThrow({ where: { id: planId }, include: { charges: true } });
  if (p.status !== 'active' && p.status !== 'paused') return;
  if (p.charges.every((c) => c.status === 'paid' || c.status === 'cancelled')) {
    await tx.billingPlan.update({ where: { id: planId }, data: { status: 'completed' } });
  }
}

export type ChargeOutcome = {
  result: 'paid' | 'failed' | 'expected' | 'skipped';
  reason?: string;
  studentName?: string;
  amountAgorot?: number;
};

/**
 * Charges one installment. Safe to call twice or concurrently: the row is claimed with a
 * conditional update, the provider gets an idempotency key per attempt, and the payment
 * key is unique per installment, so an installment can never be paid twice.
 */
export async function chargeInstallment(
  deps: Deps,
  planChargeId: string,
  actor: Actor,
  opts: { retry?: boolean } = {},
): Promise<ChargeOutcome> {
  const { db, clock } = deps;
  const now = clock.now();
  const today = israelDate(now);
  const stale = new Date(now.getTime() - STALE_MS);

  const claimable: Prisma.PlanChargeWhereInput = opts.retry
    ? { id: planChargeId, status: 'failed' }
    : {
        id: planChargeId,
        OR: [
          { status: 'pending', dueDate: { lte: today } },
          { status: 'processing', processingAt: { lt: stale } },
        ],
      };
  const current = await db.planCharge.findFirst({
    where: claimable,
    include: { plan: { include: { student: true } } },
  });
  if (!current || current.plan.status !== 'active') return { result: 'skipped' };
  const resumed = current.status === 'processing';
  const attemptNo = resumed ? current.attempts : current.attempts + 1;
  const claimed = await db.planCharge.updateMany({
    where: { id: planChargeId, status: current.status, attempts: current.attempts },
    data: { status: 'processing', processingAt: now, attempts: attemptNo },
  });
  if (claimed.count !== 1) return { result: 'skipped' };

  const plan = current.plan;
  const base = { studentName: plan.student.fullName, amountAgorot: current.amountAgorot };

  // Transfer and standing order: money arrives through the bank, never assumed (decision B5).
  if (plan.method !== 'card') {
    await db.planCharge.update({
      where: { id: planChargeId },
      data: { status: 'expected', processingAt: null },
    });
    return { result: 'expected', ...base };
  }

  const fail = async (reason: string, cardTxnId?: string) => {
    await db.$transaction(async (tx) => {
      await tx.planCharge.update({
        where: { id: planChargeId },
        data: { status: 'failed', lastError: reason, processingAt: null },
      });
      await recordAudit(tx, actor, now, {
        action: 'plan.charge_failed',
        summary: `חיוב ${formatMoney(current.amountAgorot)} ל${plan.student.fullName} נכשל: ${reason}`,
        entity: 'PlanCharge',
        entityId: planChargeId,
        after: { reason, cardTxnId },
      });
    });
    return { result: 'failed' as const, reason, ...base };
  };

  const card = plan.cardId ? await db.savedCard.findUnique({ where: { id: plan.cardId } }) : null;
  if (!card || card.removedAt) return fail('הכרטיס הוסר');
  if (isExpiredOn(card.expMonth, card.expYear, current.dueDate)) return fail('הכרטיס פג תוקף');

  const key = `plan:${planChargeId}:${attemptNo}`;
  const txn =
    (await db.cardTransaction.findUnique({ where: { idempotencyKey: key } })) ??
    (await db.cardTransaction.create({
      data: {
        idempotencyKey: key,
        kind: 'charge',
        familyId: plan.student.familyId,
        amountAgorot: current.amountAgorot,
        cardId: card.id,
        last4: card.last4,
        status: 'pending',
        planChargeId,
      },
    }));
  const total =
    plan.type === 'installments' ? await db.planCharge.count({ where: { planId: plan.id } }) : plan.count;
  const r =
    txn.status === 'approved'
      ? {
          status: 'approved' as const,
          providerTxnId: txn.providerTxnId ?? '',
          approvalCode: txn.approvalCode ?? '',
        }
      : await deps.payments.chargeToken({
          token: deps.enc.decrypt(card.tokenEnc),
          amountAgorot: current.amountAgorot,
          idempotencyKey: key,
          description: 'שכר לימוד',
        });
  if (r.status !== 'approved') {
    if (txn.status === 'pending')
      await db.cardTransaction.update({
        where: { id: txn.id },
        data: { status: r.status, errorMessageHe: r.errorMessageHe },
      });
    return fail(r.errorMessageHe, txn.id);
  }

  await db.$transaction(async (tx) => {
    const t = await tx.cardTransaction.findUniqueOrThrow({ where: { id: txn.id } });
    if (t.status === 'pending')
      await tx.cardTransaction.update({
        where: { id: txn.id },
        data: { status: 'approved', providerTxnId: r.providerTxnId, approvalCode: r.approvalCode },
      });
    const label =
      plan.type === 'installments'
        ? `פריסה ${current.seq}/${total}`
        : `חיוב חוזר ${current.seq}${total ? `/${total}` : ''}`;
    const { payment } = await recordPayment(tx, now, actor, {
      familyId: plan.student.familyId,
      method: 'card',
      amountAgorot: current.amountAgorot,
      date: today,
      reference: `${label} ****${card.last4}`,
      parts: [{ studentId: plan.studentId, amountAgorot: current.amountAgorot }],
      idempotencyKey: `plan:${planChargeId}`,
      source: 'scheduler',
      cardTxnId: txn.id,
      createdById: actor.id,
    });
    await tx.planCharge.update({
      where: { id: planChargeId },
      data: { status: 'paid', paymentId: payment.id, lastError: null, processingAt: null },
    });
    await topUpRecurring(tx, plan.id);
    await refreshCompletion(tx, plan.id);
  });
  return { result: 'paid', ...base };
}

/**
 * Runs every installment that is due. `runKey` is the lock: the nightly run uses the date,
 * so a second run on the same day (or a second server) does nothing.
 */
export async function runDueCharges(
  deps: Deps,
  opts: { runKey: string; trigger: 'schedule' | 'manual'; actor?: Actor },
): Promise<RunSummary> {
  const { db, clock } = deps;
  const actor = opts.actor ?? SYSTEM_ACTOR;
  const now = clock.now();
  const today = israelDate(now);
  let run;
  try {
    run = await db.jobRun.create({
      data: { job: 'charges', runKey: opts.runKey, trigger: opts.trigger, startedAt: now, status: 'running' },
    });
  } catch {
    return { runId: null, skipped: true, ok: 0, failed: 0, expected: 0, failures: [] };
  }
  const summary: RunSummary = { runId: run.id, skipped: false, ok: 0, failed: 0, expected: 0, failures: [] };
  try {
    const stale = new Date(now.getTime() - STALE_MS);
    const due = await db.planCharge.findMany({
      where: {
        plan: { status: 'active' },
        OR: [
          { status: 'pending', dueDate: { lte: today } },
          { status: 'processing', processingAt: { lt: stale } },
        ],
      },
      orderBy: [{ dueDate: 'asc' }, { seq: 'asc' }],
      select: { id: true },
    });
    for (const d of due) {
      const r = await chargeInstallment(deps, d.id, actor);
      if (r.result === 'paid') summary.ok++;
      else if (r.result === 'expected') summary.expected++;
      else if (r.result === 'failed') {
        summary.failed++;
        summary.failures.push({
          studentName: r.studentName ?? '',
          amountAgorot: r.amountAgorot ?? 0,
          reason: r.reason ?? '',
        });
      }
    }
    await db.jobRun.update({
      where: { id: run.id },
      data: {
        status: 'ok',
        finishedAt: clock.now(),
        okCount: summary.ok,
        failCount: summary.failed,
        summary: JSON.stringify(summary),
      },
    });
    await db.$transaction((tx) =>
      recordAudit(tx, actor, now, {
        action: 'plan.run',
        summary: `הורצו חיובים: ${summary.ok} הצליחו, ${summary.failed} נכשלו${summary.expected ? `, ${summary.expected} ממתינים להעברה בנקאית` : ''}`,
        entity: 'JobRun',
        entityId: run.id,
        after: summary,
      }),
    );
    if (opts.trigger === 'schedule' && summary.failed) {
      await notifyAdmins(
        deps,
        `חיובים שנכשלו בהרצה הלילית (${summary.failed})`,
        summary.failures
          .map((f) => `${f.studentName}: ${formatMoney(f.amountAgorot)} - ${f.reason}`)
          .join('\n'),
      );
    }
    return summary;
  } catch (e) {
    await db.jobRun.update({
      where: { id: run.id },
      data: {
        status: 'failed',
        finishedAt: clock.now(),
        summary: JSON.stringify({ error: String((e as Error).message).slice(0, 500) }),
      },
    });
    await notifyAdmins(
      deps,
      'הרצת החיובים הלילית נכשלה',
      `ההרצה ${opts.runKey} נעצרה בשגיאה. יש לבדוק את מסך תוכניות החיוב ואת יומן השרת.`,
    );
    throw e;
  }
}

export async function notifyAdmins(deps: Deps, subject: string, text: string) {
  const to = deps.config.ALERT_EMAIL
    ? [deps.config.ALERT_EMAIL]
    : (await deps.db.user.findMany({ where: { active: true } }))
        .filter((u) => (JSON.parse(u.permissions) as string[]).includes('settings'))
        .map((u) => u.email);
  for (const t of to)
    await deps.mailer.send({ to: t, subject: `[מערכת גבייה] ${subject}`, text }).catch(() => undefined);
}
