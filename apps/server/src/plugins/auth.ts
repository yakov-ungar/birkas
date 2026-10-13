import type { FastifyInstance, FastifyRequest } from 'fastify';
import { normalizePermissions, type Permission, type SessionStage } from '@tuition/shared';
import { AppError, forbidden, unauthorized } from '../lib/errors';
import { safeEqual, sha256 } from '../lib/crypto';
import { cookieName } from '../modules/auth/session';
import { getSettings } from '../modules/settings/service';
import type { Actor } from '../modules/audit/service';

export interface AuthContext {
  sessionId: string;
  stage: SessionStage;
  csrfToken: string;
  user: { id: string; name: string; email: string; role: string; permissions: Permission[] };
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const TOUCH_EVERY_MS = 30_000;

export function actorOf(req: FastifyRequest): Actor {
  const a = req.auth;
  return a
    ? { type: 'user', id: a.user.id, name: a.user.name, ip: req.ip }
    : { type: 'system', id: null, name: 'מערכת', ip: req.ip };
}

export function requireAuth(req: FastifyRequest): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

/**
 * Order: authenticate (401) → stage → permission (403) → CSRF (403).
 * Runs in preValidation so a missing permission is reported before body validation.
 */
export function registerAuth(app: FastifyInstance) {
  app.decorateRequest('auth', null);

  app.addHook('preValidation', async (req) => {
    const access = req.routeOptions.config?.access;
    const url = req.url;
    if (!url.startsWith('/api/') || req.is404) return;
    if (!access) throw new AppError(500, 'internal', 'route without access declaration');
    if (access.type === 'public') return;
    if (access.type === 'test') {
      if (!app.deps.config.ENABLE_TEST_ROUTES || app.deps.config.NODE_ENV === 'production')
        throw unauthorized();
      return;
    }

    const { db, clock, config } = app.deps;
    const token = req.cookies[cookieName(config.COOKIE_SECURE)];
    if (!token) throw unauthorized();
    const s = await db.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
    const now = clock.now();
    if (!s || s.revokedAt || s.expiresAt <= now || !s.user.active) throw unauthorized();

    if (s.stage === 'full') {
      const { idleTimeoutMin } = await getSettings(db);
      if (now.getTime() - s.lastSeenAt.getTime() > idleTimeoutMin * 60_000) {
        await db.session.update({ where: { id: s.id }, data: { revokedAt: now } });
        await db.loginEvent.create({ data: { at: now, userId: s.userId, event: 'timeout', ip: req.ip } });
        throw new AppError(401, 'idle_timeout', 'החיבור נותק עקב חוסר פעילות. יש להתחבר מחדש');
      }
    }

    if (!access.stages.includes(s.stage as SessionStage)) {
      throw new AppError(401, 'stage_required', 'יש להשלים את תהליך ההתחברות');
    }

    const permissions = normalizePermissions(JSON.parse(s.user.permissions) as string[]);
    req.auth = {
      sessionId: s.id,
      stage: s.stage as SessionStage,
      csrfToken: s.csrfToken,
      user: { id: s.user.id, name: s.user.name, email: s.user.email, role: s.user.role, permissions },
    };

    if (access.permission && !permissions.includes(access.permission)) throw forbidden();

    if (UNSAFE.has(req.method)) {
      const h = req.headers['x-csrf-token'];
      if (typeof h !== 'string' || !safeEqual(h, s.csrfToken)) {
        throw new AppError(403, 'csrf', 'פג תוקף הטופס. רעננו את הדף ונסו שוב');
      }
    }

    if (now.getTime() - s.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
      await db.session.update({ where: { id: s.id }, data: { lastSeenAt: now } });
    }
  });
}
