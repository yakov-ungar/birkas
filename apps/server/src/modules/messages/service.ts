import { formatMoney, normalizePhone } from '@tuition/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { Db, Tx } from '../../lib/db';
import type { Deps } from '../../deps';
import { israelDate } from '../../lib/clock';
import { fillTemplate, type TemplateVars } from '../../domain/templates';
import { nextAllowed, isQuiet } from '../../domain/quiet-hours';
import { addAging, type AgingBuckets } from '../../domain/ledger';
import { EMPTY, loadMoney, summarize } from '../finance/money';
import { emailDocument } from '../receipts/service';
import { signPortalLink } from '../portal/session';

export type Channel = 'sms' | 'whatsapp' | 'email';
export const CHANNEL_LABEL: Record<Channel, string> = { sms: 'SMS', whatsapp: 'וואטסאפ', email: 'מייל' };
export type RuleKey = 'pre_charge' | 'charge_failed' | 'debt_30' | 'receipt_auto';

/** Decision C13: the debt reminder goes to a family at most once in this many days. */
export const DEBT_REMINDER_EVERY_DAYS = 14;

/** Signed, time-limited link to the parent portal sign-in (decision C15). It still requires a one-time code. */
export const portalLink = (deps: Deps, familyId: string) =>
  `${deps.config.APP_BASE_URL}/portal?t=${encodeURIComponent(signPortalLink(deps, familyId, deps.clock.now()))}`;

export async function familyVars(
  deps: Deps,
  db: Db | Tx,
  familyId: string,
  extra: TemplateVars = {},
): Promise<TemplateVars> {
  const f = await db.family.findUniqueOrThrow({
    where: { id: familyId },
    include: { students: { where: { deletedAt: null }, orderBy: { enrollSeq: 'asc' } } },
  });
  const money = await loadMoney(
    db,
    f.students.map((s) => s.id),
  );
  const today = israelDate(deps.clock.now());
  const balance = f.students.reduce(
    (a, s) => a + summarize(money.get(s.id) ?? EMPTY, today).balanceAgorot,
    0,
  );
  return {
    הורה: f.parentName,
    משפחה: f.name,
    תלמיד: f.students.map((s) => s.fullName.split(' ')[0]).join(', '),
    יתרה: formatMoney(balance),
    קישור: portalLink(deps, familyId),
    ...extra,
  };
}

export async function getRule(db: Db | Tx, key: RuleKey) {
  return db.reminderRule.findUniqueOrThrow({ where: { key } });
}

interface Enqueue {
  familyId: string;
  channel: Channel;
  body: string;
  batchId: string;
  /** Automatic messages wait for allowed hours (C14); manual ones go now. */
  ruleKey?: RuleKey | null;
  dedupeKey?: string | null;
}

/** Queues one message. Returns null when the dedupe key was already used (never sent twice). */
export async function enqueue(deps: Deps, db: Db | Tx, m: Enqueue) {
  const f = await db.family.findUniqueOrThrow({ where: { id: m.familyId } });
  const to = m.channel === 'email' ? f.email : normalizePhone(f.phone);
  const now = deps.clock.now();
  const auto = !!m.ruleKey && m.channel !== 'email';
  if (m.dedupeKey && (await db.message.findUnique({ where: { dedupeKey: m.dedupeKey } }))) return null;
  return db.message.create({
    data: {
      batchId: m.batchId,
      familyId: m.familyId,
      channel: m.channel,
      to,
      body: m.body,
      status: to ? 'queued' : 'failed',
      error: to ? null : m.channel === 'email' ? 'אין כתובת מייל למשפחה' : 'אין מספר טלפון למשפחה',
      notBefore: auto ? nextAllowed(now) : now,
      dedupeKey: m.dedupeKey ?? null,
      ruleKey: m.ruleKey ?? null,
    },
  });
}

export const newBatch = (
  db: Db | Tx,
  b: {
    channel: Channel;
    source: 'manual' | 'auto';
    ruleKey?: RuleKey | null;
    template: string;
    createdByName?: string | null;
    recipientCount?: number;
  },
) =>
  db.messageBatch.create({
    data: {
      at: new Date(),
      channel: b.channel,
      source: b.source,
      ruleKey: b.ruleKey ?? null,
      template: b.template,
      createdByName: b.createdByName ?? null,
      recipientCount: b.recipientCount ?? 0,
    },
  });

/** Sends every queued message that is due; automatic texts in quiet hours are pushed to the next allowed time. */
export async function dispatch(deps: Deps, log?: FastifyBaseLogger) {
  const { db, clock } = deps;
  const now = clock.now();
  const due = await db.message.findMany({
    where: { status: 'queued', notBefore: { lte: now } },
    orderBy: { createdAt: 'asc' },
    take: 500,
  });
  let sent = 0;
  for (const m of due) {
    if (m.ruleKey && m.channel !== 'email' && isQuiet(now)) {
      await db.message.update({ where: { id: m.id }, data: { notBefore: nextAllowed(now) } });
      continue;
    }
    try {
      if (m.channel === 'email') {
        await deps.mailer.send({ to: m.to, subject: 'הודעה מבית הספר', text: m.body });
        await db.message.update({ where: { id: m.id }, data: { status: 'sent', sentAt: now } });
      } else {
        const r = await deps.texts[m.channel as 'sms' | 'whatsapp'].send(m.to, m.body);
        await db.message.update({
          where: { id: m.id },
          data: r.ok
            ? { status: 'sent', sentAt: now, providerRef: r.ref }
            : { status: 'failed', error: r.error },
        });
      }
      sent++;
    } catch (e) {
      log?.warn({ err: e, messageId: m.id }, 'message send failed');
      await db.message.update({
        where: { id: m.id },
        data: { status: 'failed', error: String((e as Error).message).slice(0, 200) },
      });
    }
  }
  return sent;
}

// ---------- recipient groups (demo "שליחת הודעה לקבוצה") ----------

export interface FamilyMoney {
  id: string;
  balanceAgorot: number;
  aging: AgingBuckets;
  grades: string[];
}

export async function familiesWithMoney(db: Db | Tx, today: string): Promise<FamilyMoney[]> {
  const fams = await db.family.findMany({
    where: { archivedAt: null },
    include: { students: { where: { deletedAt: null }, select: { id: true, grade: true } } },
  });
  const money = await loadMoney(db);
  return fams
    .filter((f) => f.students.length)
    .map((f) => {
      let bal = 0;
      let aging: AgingBuckets = [0, 0, 0, 0];
      for (const s of f.students) {
        const m = summarize(money.get(s.id) ?? EMPTY, today);
        bal += m.balanceAgorot;
        aging = addAging(aging, m.aging);
      }
      return { id: f.id, balanceAgorot: bal, aging, grades: f.students.map((s) => s.grade) };
    });
}

export type Group = 'all' | 'big' | 'aged' | 'fail' | `grade:${string}`;

export async function groupFamilies(db: Db | Tx, group: Group, today: string): Promise<string[]> {
  if (group === 'fail') {
    const pcs = await db.planCharge.findMany({
      where: { status: 'failed', plan: { status: { in: ['active', 'paused'] } } },
      include: { plan: { include: { student: { select: { familyId: true } } } } },
    });
    return [...new Set(pcs.map((p) => p.plan.student.familyId))];
  }
  const fams = (await familiesWithMoney(db, today)).filter((f) => f.balanceAgorot > 0);
  if (group === 'all') return fams.map((f) => f.id);
  if (group === 'big') return fams.filter((f) => f.balanceAgorot > 300_000).map((f) => f.id);
  if (group === 'aged') return fams.filter((f) => f.aging[1] + f.aging[2] + f.aging[3] > 0).map((f) => f.id);
  const grade = group.slice('grade:'.length);
  return fams.filter((f) => f.grades.includes(grade)).map((f) => f.id);
}

// ---------- the four rules ----------

interface RulePlanItem {
  familyId: string;
  vars: TemplateVars;
  dedupeKey: string;
}

/** Who a rule would message right now (used by "בדיקה", "שלח עכשיו" and the daily run). */
export async function rulePlan(deps: Deps, key: RuleKey): Promise<RulePlanItem[]> {
  const { db, clock } = deps;
  const today = israelDate(clock.now());
  const addDays = (n: number) => new Date(Date.parse(today) + n * 86_400_000).toISOString().slice(0, 10);
  const out: RulePlanItem[] = [];
  if (key === 'pre_charge') {
    const pcs = await db.planCharge.findMany({
      where: {
        status: 'pending',
        dueDate: { gte: today, lte: addDays(3) },
        plan: { status: 'active', method: 'card' },
      },
      include: { plan: { include: { student: true } } },
    });
    for (const c of pcs) {
      out.push({
        familyId: c.plan.student.familyId,
        vars: {
          תאריך: c.dueDate.split('-').reverse().join('/'),
          סכום: formatMoney(c.amountAgorot),
          תלמיד: c.plan.student.fullName.split(' ')[0]!,
        },
        dedupeKey: `pre_charge:${c.id}`,
      });
    }
  } else if (key === 'charge_failed') {
    const pcs = await db.planCharge.findMany({
      where: { status: 'failed', plan: { status: 'active' } },
      include: { plan: { include: { student: true } } },
    });
    for (const c of pcs) {
      out.push({
        familyId: c.plan.student.familyId,
        vars: {
          סיבה: c.lastError ?? '',
          סכום: formatMoney(c.amountAgorot),
          תאריך: c.dueDate.split('-').reverse().join('/'),
          תלמיד: c.plan.student.fullName.split(' ')[0]!,
        },
        dedupeKey: `charge_failed:${c.id}:${c.attempts}`,
      });
    }
  } else if (key === 'debt_30') {
    const fams = await groupFamilies(db, 'aged', today);
    const since = new Date(clock.now().getTime() - DEBT_REMINDER_EVERY_DAYS * 86_400_000);
    for (const id of fams) {
      const recent = await db.message.findFirst({
        where: { familyId: id, ruleKey: 'debt_30', createdAt: { gte: since } },
      });
      if (!recent) out.push({ familyId: id, vars: {}, dedupeKey: `debt_30:${id}:${today}` });
    }
  } else {
    const unsent = await db.receipt.findMany({ where: { sentAt: null, docType: 'receipt' }, take: 500 });
    for (const r of unsent) out.push({ familyId: r.familyId, vars: {}, dedupeKey: `receipt:${r.id}` });
  }
  return out;
}

export async function preview(deps: Deps, key: RuleKey) {
  const rule = await getRule(deps.db, key);
  const plan = await rulePlan(deps, key);
  const example = plan[0]
    ? fillTemplate(rule.template, await familyVars(deps, deps.db, plan[0].familyId, plan[0].vars))
    : null;
  return { count: plan.length, channel: rule.channel as Channel, example };
}

/** Queues a rule's messages now (respecting dedupe and allowed hours). Returns how many were queued. */
export async function runRule(deps: Deps, key: RuleKey, createdByName: string | null): Promise<number> {
  const { db } = deps;
  const rule = await getRule(db, key);
  const plan = await rulePlan(deps, key);
  if (!plan.length) return 0;
  if (key === 'receipt_auto') {
    let n = 0;
    for (const p of plan)
      if (await onReceipt(deps, undefined, p.familyId, p.dedupeKey.slice('receipt:'.length), { force: true }))
        n++;
    return n;
  }
  const batch = await newBatch(db, {
    channel: rule.channel as Channel,
    source: 'auto',
    ruleKey: key,
    template: rule.template,
    createdByName,
  });
  let n = 0;
  for (const p of plan) {
    const body = fillTemplate(rule.template, await familyVars(deps, db, p.familyId, p.vars));
    if (
      await enqueue(deps, db, {
        familyId: p.familyId,
        channel: rule.channel as Channel,
        body,
        batchId: batch.id,
        ruleKey: key,
        dedupeKey: p.dedupeKey,
      })
    )
      n++;
  }
  await db.messageBatch.update({ where: { id: batch.id }, data: { recipientCount: n } });
  await dispatch(deps);
  return n;
}

/** Rule 2: a failed card charge notifies the parent (in allowed hours). */
export async function onChargeFailed(deps: Deps, planChargeId: string) {
  const rule = await getRule(deps.db, 'charge_failed');
  if (!rule.enabled) return;
  const c = await deps.db.planCharge.findUniqueOrThrow({
    where: { id: planChargeId },
    include: { plan: { include: { student: true } } },
  });
  const body = fillTemplate(
    rule.template,
    await familyVars(deps, deps.db, c.plan.student.familyId, {
      סיבה: c.lastError ?? '',
      סכום: formatMoney(c.amountAgorot),
      תאריך: c.dueDate.split('-').reverse().join('/'),
      תלמיד: c.plan.student.fullName.split(' ')[0]!,
    }),
  );
  const batch = await newBatch(deps.db, {
    channel: rule.channel as Channel,
    source: 'auto',
    ruleKey: 'charge_failed',
    template: rule.template,
    recipientCount: 1,
  });
  await enqueue(deps, deps.db, {
    familyId: c.plan.student.familyId,
    channel: rule.channel as Channel,
    body,
    batchId: batch.id,
    ruleKey: 'charge_failed',
    dedupeKey: `charge_failed:${c.id}:${c.attempts}`,
  });
  await dispatch(deps);
}

/** Rule 4: a new receipt goes to the parent by the rule's channel (email carries the PDF). */
export async function onReceipt(
  deps: Deps,
  log: FastifyBaseLogger | undefined,
  familyId: string,
  receiptId: string,
  opts: { force?: boolean } = {},
) {
  const rule = await getRule(deps.db, 'receipt_auto');
  if (!rule.enabled && !opts.force) return false;
  const f = await deps.db.family.findUnique({ where: { id: familyId } });
  if (!f) return false;
  try {
    if (rule.channel === 'email') {
      if (!f.email) return false;
      await emailDocument(deps, receiptId, f.email);
    } else {
      const batch = await newBatch(deps.db, {
        channel: rule.channel as Channel,
        source: 'auto',
        ruleKey: 'receipt_auto',
        template: rule.template,
        recipientCount: 1,
      });
      const body = fillTemplate(rule.template, await familyVars(deps, deps.db, familyId));
      const m = await enqueue(deps, deps.db, {
        familyId,
        channel: rule.channel as Channel,
        body,
        batchId: batch.id,
        ruleKey: 'receipt_auto',
        dedupeKey: `receipt:${receiptId}`,
      });
      if (!m) return false;
      await deps.db.receipt.update({
        where: { id: receiptId },
        data: { sentAt: deps.clock.now(), sentTo: m.to },
      });
      await dispatch(deps);
    }
    return true;
  } catch (e) {
    log?.warn({ err: e, receiptId }, 'receipt delivery failed');
    return false;
  }
}

/** Daily run of the time-based rules (1 and 3); the JobRun key keeps it to once a day. */
export async function runDailyReminders(deps: Deps) {
  const runKey = israelDate(deps.clock.now());
  try {
    await deps.db.jobRun.create({
      data: { job: 'reminders', runKey, trigger: 'schedule', startedAt: deps.clock.now(), status: 'running' },
    });
  } catch {
    return { ran: false };
  }
  const counts: Record<string, number> = {};
  for (const key of ['pre_charge', 'debt_30'] as RuleKey[]) {
    if ((await getRule(deps.db, key)).enabled) counts[key] = await runRule(deps, key, null);
  }
  await deps.db.jobRun.update({
    where: { job_runKey: { job: 'reminders', runKey } },
    data: { status: 'ok', finishedAt: deps.clock.now(), summary: JSON.stringify(counts) },
  });
  return { ran: true, counts };
}
