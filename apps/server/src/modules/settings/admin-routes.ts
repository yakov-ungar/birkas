import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  INTEGRATIONS,
  generalPatchSchema,
  integrationConfigSchema,
  yearOpenSchema,
  type IntegrationKey,
  type IntegrationRow,
} from '@tuition/shared';
import { staff } from '../../plugins/access';
import { actorOf } from '../../plugins/auth';
import { badRequest, notFound, parse } from '../../lib/errors';
import { israelDate } from '../../lib/clock';
import { recordAudit } from '../audit/service';
import { recalcSiblings } from '../finance/charges';
import { getSettings, saveSettings } from './service';
import { openYear, previewYear, yearInfo } from '../year/service';
import type { Deps } from '../../deps';
import type { Integration } from '@prisma/client';

const keyParam = z.object({
  key: z.enum(Object.keys(INTEGRATIONS) as [IntegrationKey, ...IntegrationKey[]]),
});

/** The provider that actually runs today. Only mocks exist until real providers are chosen (stage 9). */
function providerOf(deps: Deps, key: IntegrationKey): string {
  switch (key) {
    case 'card':
      return `${deps.payments.name === 'mock' ? 'ספק מדומה' : deps.payments.name} · מצב בדיקה`;
    case 'masav':
      return 'קובץ ידני (לבדיקה בלבד)';
    case 'sms':
    case 'whatsapp':
      return 'ספק מדומה, לא נשלחות הודעות אמיתיות';
    case 'email':
      return deps.config.MAIL_TRANSPORT === 'smtp' ? 'שרת SMTP מהגדרות השרת' : 'תיבת יוצא פנימית (בדיקה)';
    case 'accounting':
      return 'ייצוא CSV מהדוחות';
  }
}

const toRow = (deps: Deps, i: Integration): IntegrationRow => ({
  key: i.key as IntegrationKey,
  name: INTEGRATIONS[i.key as IntegrationKey],
  connected: i.connected,
  mode: i.mode === 'live' ? 'live' : 'test',
  details: i.details,
  provider: providerOf(deps, i.key as IntegrationKey),
  updatedAt: i.updatedAt?.toISOString() ?? null,
});

export async function settingsAdminRoutes(app: FastifyInstance) {
  const deps = app.deps;
  const { db, clock } = deps;

  // ---------- general (demo editCfg) ----------

  app.patch('/api/settings/general', { config: { access: staff('settings') } }, async (req) => {
    const input = parse(generalPatchSchema, req.body);
    const before = await getSettings(db);
    const now = clock.now();
    const today = israelDate(now);
    const actor = actorOf(req);
    await db.$transaction(async (tx) => {
      const removed = before.grades.filter((g) => !input.grades.includes(g));
      if (removed.length) {
        const inUse = await tx.student.findMany({
          where: { deletedAt: null, status: 'active', grade: { in: removed } },
          select: { grade: true },
          distinct: ['grade'],
        });
        if (inUse.length)
          throw badRequest(`יש תלמידים פעילים בכיתה ${inUse.map((x) => x.grade).join(', ')}`, {
            grades: 'אי אפשר להסיר כיתה שיש בה תלמידים',
          });
      }
      if (new Set(input.grades).size !== input.grades.length)
        throw badRequest('כיתה מופיעה פעמיים', { grades: 'כיתה מופיעה פעמיים' });
      await saveSettings(tx, input);
      await recordAudit(tx, actor, now, {
        action: 'settings.general',
        summary: 'עודכנו הגדרות כלליות',
        entity: 'Setting',
        before: { ...before, require2fa: undefined },
        after: input,
      });
      // Demo: a change in the sibling percentages recalculates every family, by reversal and a new line.
      if (before.siblingPct.some((p, i) => p !== input.siblingPct[i])) {
        const fams = await tx.family.findMany({
          where: { students: { some: { deletedAt: null } } },
          select: { id: true },
        });
        for (const f of fams) await recalcSiblings(tx, f.id, actor, now, today);
      }
    });
    return { settings: await getSettings(db) };
  });

  // ---------- integrations (demo "חיבורים") ----------

  app.get('/api/settings/integrations', { config: { access: staff('settings') } }, async () => {
    const rows = await db.integration.findMany();
    const order = Object.keys(INTEGRATIONS);
    rows.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    return { integrations: rows.map((r) => toRow(deps, r)) };
  });

  app.post('/api/settings/integrations/:key/test', { config: { access: staff('settings') } }, async (req) => {
    const { key } = parse(keyParam, req.params);
    const i = await db.integration.findUnique({ where: { key } });
    if (!i) throw notFound('השירות לא נמצא');
    if (key === 'card') {
      const r = await deps.payments.testConnection();
      return {
        ok: r.ok,
        messageHe: `${INTEGRATIONS[key]}: ${r.messageHe}, תשובה תוך ${r.latencyMs} מילישניות`,
      };
    }
    // No real provider exists yet: say what is running instead of pretending to connect.
    return { ok: true, messageHe: `${INTEGRATIONS[key]}: ${providerOf(deps, key)}` };
  });

  /** Stores credentials for later (stage 9). Nothing connects outside with them yet. */
  app.post('/api/settings/integrations/:key', { config: { access: staff('settings') } }, async (req) => {
    const { key } = parse(keyParam, req.params);
    const input = parse(integrationConfigSchema, req.body);
    const now = clock.now();
    const visible =
      input.username.length > 4 ? `${input.username.slice(0, 2)}***${input.username.slice(-2)}` : '***';
    const row = await db.$transaction(async (tx) => {
      const r = await tx.integration.update({
        where: { key },
        data: {
          connected: true,
          mode: input.mode,
          configEnc: deps.enc.encrypt(JSON.stringify({ username: input.username, secret: input.secret })),
          details: `משתמש ${visible} · מצב בדיקה`,
          updatedAt: now,
          updatedByName: req.auth!.user.name,
        },
      });
      await recordAudit(tx, actorOf(req), now, {
        action: 'integration.configure',
        summary: `הוגדר חיבור: ${INTEGRATIONS[key]}`,
        entity: 'Integration',
        entityId: key,
        after: { connected: true, mode: input.mode, details: r.details },
      });
      return r;
    });
    return { integration: toRow(deps, row) };
  });

  app.post(
    '/api/settings/integrations/:key/disconnect',
    { config: { access: staff('settings') } },
    async (req) => {
      const { key } = parse(keyParam, req.params);
      const now = clock.now();
      const row = await db.$transaction(async (tx) => {
        const r = await tx.integration.update({
          where: { key },
          data: {
            connected: false,
            configEnc: null,
            details: '',
            updatedAt: now,
            updatedByName: req.auth!.user.name,
          },
        });
        await recordAudit(tx, actorOf(req), now, {
          action: 'integration.disconnect',
          summary: `נותק: ${INTEGRATIONS[key]}`,
          entity: 'Integration',
          entityId: key,
        });
        return r;
      });
      return { integration: toRow(deps, row) };
    },
  );

  // ---------- school year (demo newYear) ----------

  app.get('/api/settings/year', { config: { access: staff('settings') } }, async () => yearInfo(db));

  app.post('/api/settings/year/preview', { config: { access: staff('settings') } }, async (req) =>
    previewYear(db, parse(yearOpenSchema, req.body)),
  );

  app.post('/api/settings/year/open', { config: { access: staff('settings') } }, async (req) =>
    openYear(deps, parse(yearOpenSchema, req.body), actorOf(req)),
  );
}
