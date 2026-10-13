import type { FastifyInstance } from 'fastify';
import { securitySettingsSchema, type LoginEventRow } from '@tuition/shared';
import { staff } from '../../plugins/access';
import { actorOf } from '../../plugins/auth';
import { parse } from '../../lib/errors';
import { recordAudit } from '../audit/service';
import { getSettings, saveSettings } from './service';

const EVENT_LABEL: Record<string, string> = {
  success: 'התחברות',
  password_ok: 'סיסמה נכונה, ממתין לאימות',
  fail: 'ניסיון כושל',
  locked: 'ניסיון בזמן נעילה',
  '2fa_fail': 'קוד אימות שגוי',
  logout: 'התנתקות',
  timeout: 'ניתוק עקב חוסר פעילות',
};

/** Coarse device label from the user agent, as shown in the demo ("Chrome · Windows"). */
function device(ua: string | null): string {
  if (!ua) return '-';
  const b = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'דפדפן';
  const o = /Windows/.test(ua)
    ? 'Windows'
    : /iPhone|iPad/.test(ua)
      ? 'iPhone'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac OS/.test(ua)
          ? 'Mac'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return o ? `${b} · ${o}` : b;
}

const securityPatch = securitySettingsSchema.partial().strict();

export async function settingsRoutes(app: FastifyInstance) {
  const { db, clock } = app.deps;

  app.get('/api/settings', { config: { access: staff('settings') } }, async () => ({
    settings: await getSettings(db),
  }));

  app.patch('/api/settings/security', { config: { access: staff('settings') } }, async (req) => {
    const patch = parse(securityPatch, req.body);
    const before = await getSettings(db);
    await db.$transaction(async (tx) => {
      await saveSettings(tx, patch);
      const pick = (s: typeof before) => ({
        require2fa: s.require2fa,
        idleTimeoutMin: s.idleTimeoutMin,
        minPasswordLength: s.minPasswordLength,
        maxFailedLogins: s.maxFailedLogins,
      });
      await recordAudit(tx, actorOf(req), clock.now(), {
        action: 'settings.security',
        summary: 'שונתה הגדרת אבטחה',
        entity: 'Setting',
        before: pick(before),
        after: pick({ ...before, ...patch }),
      });
    });
    return { settings: await getSettings(db) };
  });

  app.get('/api/settings/login-events', { config: { access: staff('settings') } }, async () => {
    const rows = await db.loginEvent.findMany({ orderBy: { at: 'desc' }, take: 50 });
    const ids = [...new Set(rows.map((r) => r.userId).filter((x): x is string => !!x))];
    const users = new Map(
      (await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map((u) => [
        u.id,
        u.name,
      ]),
    );
    const out: LoginEventRow[] = rows.map((r) => ({
      id: r.id,
      at: r.at.toISOString(),
      user: (r.userId && users.get(r.userId)) || 'משתמש לא מוכר',
      event: EVENT_LABEL[r.event] ?? r.event,
      device: device(r.userAgent),
    }));
    return { events: out };
  });
}
