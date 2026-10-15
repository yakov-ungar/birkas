import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  groupSendSchema,
  noteCreateSchema,
  ruleUpdateSchema,
  type BatchRow,
  type DebtorRow,
  type RuleRow,
} from '@tuition/shared';
import { staff } from '../../plugins/access';
import { actorOf } from '../../plugins/auth';
import { badRequest, conflict, notFound, parse } from '../../lib/errors';
import { recordAudit } from '../audit/service';
import { agingLabel } from '../../domain/ledger';
import { fillTemplate } from '../../domain/templates';
import { todayOf } from '../finance/context';
import {
  CHANNEL_LABEL,
  dispatch,
  enqueue,
  familiesWithMoney,
  familyVars,
  groupFamilies,
  newBatch,
  preview,
  runRule,
  type Channel,
  type Group,
  type RuleKey,
  assertChannel,
  effectiveChannel,
} from './service';
import { lastContact, noteRows, openPromise } from './collection';

const ruleKey = z.object({ key: z.enum(['pre_charge', 'charge_failed', 'debt_30', 'receipt_auto']) });
const idParam = z.object({ id: z.string().min(1).max(40) });

export async function messageRoutes(app: FastifyInstance) {
  const deps = app.deps;
  const { db, clock } = deps;

  // ---------- debtors (demo "מעקב חייבים") ----------
  app.get('/api/collection/debtors', { config: { access: staff('msg') } }, async (req) => {
    const { minAge, minBalance } = parse(
      z.object({
        minAge: z.coerce
          .number()
          .int()
          .refine((v) => [0, 30, 60, 90].includes(v))
          .default(0),
        minBalance: z.coerce.number().int().min(0).default(0),
      }),
      req.query,
    );
    const today = todayOf(deps);
    const fams = (await familiesWithMoney(db, today)).filter((f) => f.balanceAgorot > (minBalance ?? 0));
    const from = minAge === 30 ? 1 : minAge === 60 ? 2 : minAge === 90 ? 3 : 0;
    const names = new Map(
      (await db.family.findMany({ select: { id: true, name: true } })).map((f) => [f.id, f.name]),
    );
    const rows: DebtorRow[] = [];
    for (const f of fams
      .filter((x) => !minAge || x.aging.slice(from).some((v) => v > 0))
      .sort((a, b) => b.balanceAgorot - a.balanceAgorot)) {
      const lc = await lastContact(db, f.id);
      rows.push({
        familyId: f.id,
        name: names.get(f.id) ?? '',
        balanceAgorot: f.balanceAgorot,
        agingLabel: agingLabel(f.aging),
        lastContact: lc,
        daysSinceContact: lc ? Math.round((Date.parse(today) - Date.parse(lc)) / 86_400_000) : null,
        promise: await openPromise(db, f.id, today),
      });
    }
    return { debtors: rows };
  });

  // ---------- contact log ----------
  app.get('/api/families/:id/notes', { config: { access: staff('msg') } }, async (req) => ({
    notes: await noteRows(db, parse(idParam, req.params).id, todayOf(deps)),
  }));

  app.post('/api/families/:id/notes', { config: { access: staff('msg') } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const input = parse(noteCreateSchema, req.body);
    const now = clock.now();
    return db.$transaction(async (tx) => {
      const f = await tx.family.findUnique({ where: { id } });
      if (!f) throw notFound('המשפחה לא נמצאה');
      const n = await tx.contactNote.create({
        data: {
          familyId: id,
          at: now,
          date: todayOf(deps),
          byId: req.auth!.user.id,
          byName: req.auth!.user.name,
          type: input.type,
          note: input.note,
          promiseDate: input.type === 'promise' ? input.promiseDate! : null,
          promiseAgorot: input.type === 'promise' ? input.promiseAgorot! : null,
        },
      });
      await recordAudit(tx, actorOf(req), now, {
        action: 'collection.note',
        summary: `הערת גבייה ל${f.name}: ${input.type === 'promise' ? 'הבטחת תשלום' : input.note.slice(0, 40)}`,
        entity: 'ContactNote',
        entityId: n.id,
        after: n,
      });
      return { id: n.id };
    });
  });

  app.post('/api/notes/:id/fulfilled', { config: { access: staff('msg') } }, async (req) => {
    const { id } = parse(idParam, req.params);
    return db.$transaction(async (tx) => {
      const n = await tx.contactNote.findUnique({ where: { id } });
      if (!n || n.type !== 'promise') throw notFound('ההבטחה לא נמצאה');
      if (n.fulfilledAt) throw conflict('ההבטחה כבר סומנה כבוצעה');
      await tx.contactNote.update({
        where: { id },
        data: { fulfilledAt: clock.now(), fulfilledById: req.auth!.user.id },
      });
      await recordAudit(tx, actorOf(req), clock.now(), {
        action: 'collection.promise_done',
        summary: 'הבטחת תשלום סומנה כבוצעה',
        entity: 'ContactNote',
        entityId: id,
      });
      return { ok: true };
    });
  });

  // ---------- reminder rules ----------
  app.get('/api/messages/rules', { config: { access: staff('msg') } }, async () => {
    const order: RuleKey[] = ['pre_charge', 'charge_failed', 'debt_30', 'receipt_auto'];
    const rules = await db.reminderRule.findMany();
    const out: RuleRow[] = [];
    for (const r of order.map((k) => rules.find((x) => x.key === k)!))
      out.push({
        key: r.key as RuleKey,
        name: r.name,
        enabled: r.enabled,
        // What the rule really uses (email while text messaging is off).
        channel: await effectiveChannel(db, r.channel as Channel),
        template: r.template,
      });
    return { rules: out };
  });

  app.patch('/api/messages/rules/:key', { config: { access: staff('msg') } }, async (req) => {
    const { key } = parse(ruleKey, req.params);
    const input = parse(ruleUpdateSchema, req.body);
    if (input.channel) await assertChannel(db, input.channel as Channel);
    return db.$transaction(async (tx) => {
      const before = await tx.reminderRule.findUniqueOrThrow({ where: { key } });
      const after = await tx.reminderRule.update({ where: { key }, data: input });
      await recordAudit(tx, actorOf(req), clock.now(), {
        action: 'messages.rule',
        summary: `עודכנה תזכורת: ${before.name}`,
        entity: 'ReminderRule',
        entityId: key,
        before,
        after,
      });
      return { ok: true };
    });
  });

  /** "בדיקה": how many messages the rule would send now, with an example. Sends nothing. */
  app.get('/api/messages/rules/:key/preview', { config: { access: staff('msg') } }, async (req) =>
    preview(deps, parse(ruleKey, req.params).key),
  );

  app.post('/api/messages/rules/:key/run', { config: { access: staff('msg') } }, async (req) => {
    const { key } = parse(ruleKey, req.params);
    const n = await runRule(deps, key, req.auth!.user.name);
    const rule = await db.reminderRule.findUniqueOrThrow({ where: { key } });
    await db.$transaction((tx) =>
      recordAudit(tx, actorOf(req), clock.now(), {
        action: 'messages.rule_run',
        summary: `הורצה תזכורת: ${rule.name} (${n})`,
        entity: 'ReminderRule',
        entityId: key,
      }),
    );
    return { queued: n };
  });

  // ---------- group send ----------
  app.post('/api/messages/group/preview', { config: { access: staff('msg') } }, async (req) => {
    const input = parse(groupSendSchema, req.body);
    await assertChannel(db, input.channel);
    const ids = await groupFamilies(db, input.group as Group, todayOf(deps));
    return {
      count: ids.length,
      example: ids[0] ? fillTemplate(input.template, await familyVars(deps, db, ids[0])) : null,
      channelLabel: CHANNEL_LABEL[input.channel],
    };
  });

  app.post('/api/messages/group', { config: { access: staff('msg') } }, async (req) => {
    const input = parse(groupSendSchema, req.body);
    await assertChannel(db, input.channel);
    const ids = await groupFamilies(db, input.group as Group, todayOf(deps));
    if (!ids.length) throw badRequest('אין נמענים בקבוצה שנבחרה');
    if (input.expectedCount !== undefined && input.expectedCount !== ids.length)
      throw conflict('מספר הנמענים השתנה מאז התצוגה המקדימה. נסו שוב');
    const batch = await newBatch(db, {
      at: clock.now(),
      channel: input.channel,
      source: 'manual',
      template: input.template,
      createdByName: req.auth!.user.name,
      recipientCount: ids.length,
    });
    for (const id of ids) {
      await enqueue(deps, db, {
        familyId: id,
        channel: input.channel,
        body: fillTemplate(input.template, await familyVars(deps, db, id)),
        batchId: batch.id,
      });
    }
    await dispatch(deps, req.log);
    await db.$transaction((tx) =>
      recordAudit(tx, actorOf(req), clock.now(), {
        action: 'messages.group',
        summary: `נשלחו ${ids.length} הודעות ב${CHANNEL_LABEL[input.channel]}`,
        entity: 'MessageBatch',
        entityId: batch.id,
      }),
    );
    const failed = await db.message.count({ where: { batchId: batch.id, status: 'failed' } });
    return { batchId: batch.id, count: ids.length, failed };
  });

  app.get('/api/messages/history', { config: { access: staff('msg') } }, async () => {
    const batches = await db.messageBatch.findMany({
      orderBy: { at: 'desc' },
      take: 100,
      include: { messages: { select: { status: true } } },
    });
    const rules = new Map((await db.reminderRule.findMany()).map((r) => [r.key, r.name]));
    const out: BatchRow[] = batches.map((b) => ({
      id: b.id,
      at: b.at.toISOString(),
      channel: b.channel as Channel,
      recipients: b.messages.length || b.recipientCount,
      sent: b.messages.filter((m) => m.status === 'sent').length,
      queued: b.messages.filter((m) => m.status === 'queued').length,
      failed: b.messages.filter((m) => m.status === 'failed').length,
      template: b.template,
      source: b.source as 'manual' | 'auto',
      ruleName: b.ruleKey ? (rules.get(b.ruleKey) ?? null) : null,
    }));
    return { batches: out };
  });
}
