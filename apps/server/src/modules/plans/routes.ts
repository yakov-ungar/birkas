import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { planCreateSchema, planInputSchema, swapCardSchema, type PlanDetail } from '@tuition/shared';
import { staff } from '../../plugins/access';
import { actorOf } from '../../plugins/auth';
import { badRequest, conflict, notFound, parse } from '../../lib/errors';
import { recordAudit } from '../audit/service';
import { todayOf } from '../finance/context';
import { planLabel } from '../../domain/schedule';
import { consentFor, createPlan, validatePlan } from './create';
import { chargeInstallment, planRows, refreshCompletion, runDueCharges, toPlanRow } from './service';
import type { Deps } from '../../deps';
import type { Tx } from '../../lib/db';
import { isExpiredOn } from '../cards/service';
import type { BillingPlan } from '@prisma/client';

const idParam = z.object({ id: z.string().min(1).max(40) });

async function detail(deps: Deps, id: string): Promise<PlanDetail> {
  const p = await deps.db.billingPlan.findUnique({
    where: { id },
    include: {
      charges: { orderBy: { seq: 'asc' } },
      student: { select: { fullName: true } },
      standingOrder: true,
    },
  });
  if (!p) throw notFound('התוכנית לא נמצאה');
  const receipts = await deps.db.receipt.findMany({
    where: { paymentId: { in: p.charges.map((c) => c.paymentId).filter((x): x is string => !!x) } },
    select: { id: true, paymentId: true },
  });
  const byPayment = new Map(receipts.map((r) => [r.paymentId, r.id]));
  return {
    ...toPlanRow(p),
    charges: p.charges.map((c) => ({
      id: c.id,
      seq: c.seq,
      dueDate: c.dueDate,
      amountAgorot: c.amountAgorot,
      status: c.status as PlanDetail['charges'][number]['status'],
      lastError: c.lastError,
      receiptId: c.paymentId ? (byPayment.get(c.paymentId) ?? null) : null,
    })),
    cardId: p.cardId,
    standingOrder: p.standingOrder
      ? {
          bank: p.standingOrder.bank,
          branch: p.standingOrder.branch,
          accountLast4: p.standingOrder.accountLast4,
        }
      : null,
    consent: p.consentAt
      ? { method: p.consentMethod ?? '', text: p.consentText ?? '', at: p.consentAt.toISOString() }
      : null,
  };
}

export { detail as planDetail };

export async function planRoutes(app: FastifyInstance) {
  const deps = app.deps;
  const { db, clock } = deps;

  /** Runs a change inside one transaction; `fn` must write through `tx` only. */
  const mutate = async (
    req: FastifyRequest,
    id: string,
    fn: (tx: Tx, plan: BillingPlan) => Promise<string>,
  ) => {
    const now = clock.now();
    await db.$transaction(async (tx) => {
      const p = await tx.billingPlan.findUnique({ where: { id }, include: { student: true } });
      if (!p) throw notFound('התוכנית לא נמצאה');
      const summary = await fn(tx, p);
      await recordAudit(tx, actorOf(req), now, {
        action: 'plan.update',
        summary: `${summary} של ${p.student.fullName}`,
        entity: 'BillingPlan',
        entityId: id,
      });
    });
    return detail(deps, id);
  };

  app.get('/api/plans', { config: { access: staff('plans') } }, async () => ({ plans: await planRows(db) }));

  app.get('/api/plans/:id', { config: { access: staff('plans') } }, async (req) =>
    detail(deps, parse(idParam, req.params).id),
  );

  app.post('/api/plans/preview', { config: { access: staff('plans') } }, async (req) => {
    const input = parse(planInputSchema, req.body);
    const { student, schedule } = await validatePlan(deps.db, input);
    return {
      label: planLabel(input.type, input.count, schedule.length),
      studentName: student.fullName,
      schedule: schedule.slice(0, 6),
      total: schedule.length,
      openEnded: input.type === 'recurring' && input.count === 0,
      consentText: consentFor(input, student.family.parentName),
    };
  });

  app.post('/api/plans', { config: { access: staff('plans') } }, async (req) => {
    const { plan: input, idempotencyKey, consent } = parse(planCreateSchema, req.body);
    const existing = await db.billingPlan.findUnique({ where: { idempotencyKey } });
    if (existing) return detail(deps, existing.id);
    if (input.method !== 'transfer' && !consent)
      throw badRequest('יש לאשר שההורה הסכים לחיוב', { consent: 'נדרש אישור ההורה' });
    const now = clock.now();
    const id = await db.$transaction((tx) =>
      createPlan(deps, tx, input, {
        idempotencyKey,
        consentMethod: consent?.method ?? null,
        actor: actorOf(req),
        now,
        userId: req.auth!.user.id,
      }),
    );
    return detail(deps, id);
  });

  app.post('/api/plans/:id/pause', { config: { access: staff('plans') } }, async (req) =>
    mutate(req, parse(idParam, req.params).id, async (tx, p) => {
      if (p.status !== 'active') throw conflict('התוכנית אינה פעילה');
      await tx.billingPlan.update({ where: { id: p.id }, data: { status: 'paused' } });
      return 'הושהתה תוכנית';
    }),
  );

  app.post('/api/plans/:id/resume', { config: { access: staff('plans') } }, async (req) =>
    mutate(req, parse(idParam, req.params).id, async (tx, p) => {
      if (p.status !== 'paused') throw conflict('התוכנית אינה מושהית');
      await tx.billingPlan.update({ where: { id: p.id }, data: { status: 'active' } });
      return 'חודשה תוכנית';
    }),
  );

  app.post('/api/plans/:id/cancel', { config: { access: staff('plans') } }, async (req) =>
    mutate(req, parse(idParam, req.params).id, async (tx, p) => {
      if (p.status === 'cancelled' || p.status === 'completed')
        throw conflict('התוכנית כבר הסתיימה או בוטלה');
      if (await tx.planCharge.count({ where: { planId: p.id, status: 'processing' } }))
        throw conflict('יש חיוב בביצוע כרגע. נסו שוב בעוד דקה');
      await tx.planCharge.updateMany({
        where: { planId: p.id, status: { in: ['pending', 'failed', 'expected'] } },
        data: { status: 'cancelled' },
      });
      await tx.billingPlan.update({ where: { id: p.id }, data: { status: 'cancelled' } });
      return 'בוטלו החיובים הנותרים בתוכנית';
    }),
  );

  app.post('/api/plans/:id/swap-card', { config: { access: staff('plans') } }, async (req) => {
    const { cardId } = parse(swapCardSchema, req.body);
    return mutate(req, parse(idParam, req.params).id, async (tx, p) => {
      if (p.method !== 'card') throw badRequest('התוכנית אינה בכרטיס אשראי');
      const c = await tx.savedCard.findFirst({
        where: { id: cardId, studentId: p.studentId, removedAt: null },
      });
      if (!c) throw notFound('הכרטיס לא נמצא');
      await tx.billingPlan.update({ where: { id: p.id }, data: { cardId } });
      return `הוחלף כרטיס (****${c.last4}) בתוכנית`;
    });
  });

  app.post('/api/plans/:id/charges/:chargeId/retry', { config: { access: staff('plans') } }, async (req) => {
    const { id, chargeId } = parse(
      z.object({ id: z.string().min(1).max(40), chargeId: z.string().min(1).max(40) }),
      req.params,
    );
    const pc = await db.planCharge.findFirst({
      where: { id: chargeId, planId: id },
      include: { plan: true },
    });
    if (!pc) throw notFound('החיוב לא נמצא');
    if (pc.status !== 'failed') throw conflict('אפשר לנסות שוב רק חיוב שנכשל');
    if (pc.plan.status !== 'active') throw conflict('התוכנית אינה פעילה');
    const r = await chargeInstallment(deps, chargeId, actorOf(req), { retry: true });
    await db.$transaction((tx) => refreshCompletion(tx, id));
    return { result: r.result, reason: r.reason ?? null, plan: await detail(deps, id) };
  });

  /** "הרץ חיובים שהגיע מועדם": same code path as the nightly run; installments are claimed one by one. */
  app.post('/api/plans/run', { config: { access: staff('plans') } }, async (req) => {
    const runKey = `manual:${clock.now().toISOString()}:${req.id}`;
    return runDueCharges(deps, { runKey, trigger: 'manual', actor: actorOf(req) });
  });

  app.get('/api/plans/runs', { config: { access: staff('plans') } }, async () => {
    const runs = await db.jobRun.findMany({
      where: { job: 'charges' },
      orderBy: { startedAt: 'desc' },
      take: 20,
    });
    return {
      runs: runs.map((r) => ({
        id: r.id,
        runKey: r.runKey,
        trigger: r.trigger,
        startedAt: r.startedAt.toISOString(),
        status: r.status,
        ok: r.okCount,
        failed: r.failCount,
      })),
    };
  });

  /** Cards a plan may use (the student's own), for users with "plans" even without "cards". */
  app.get('/api/plans/student-cards/:id', { config: { access: staff('plans') } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const today = todayOf(deps);
    const cards = await db.savedCard.findMany({
      where: { studentId: id, removedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return {
      cards: cards.map((c) => ({
        id: c.id,
        label: `${c.brand} ****${c.last4} (${String(c.expMonth).padStart(2, '0')}/${String(c.expYear % 100).padStart(2, '0')})`,
        isDefault: c.isDefault,
        expired: isExpiredOn(c.expMonth, c.expYear, today),
      })),
    };
  });

  app.get('/api/plans/due-count', { config: { access: staff('plans') } }, async () => ({
    today: todayOf(deps),
    due: await db.planCharge.count({
      where: { status: 'pending', dueDate: { lte: todayOf(deps) }, plan: { status: 'active' } },
    }),
  }));
}
