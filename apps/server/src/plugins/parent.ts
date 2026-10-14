import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError, unauthorized } from '../lib/errors';
import { safeEqual, sha256 } from '../lib/crypto';
import { PARENT_IDLE_MINUTES, parentCookie } from '../modules/portal/session';
import type { Actor } from '../modules/audit/service';

export interface ParentContext {
  sessionId: string;
  familyId: string;
  parentName: string;
  csrfToken: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    parent: ParentContext | null;
  }
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const TOUCH_EVERY_MS = 30_000;

export function requireParent(req: FastifyRequest): ParentContext {
  if (!req.parent) throw unauthorized();
  return req.parent;
}

export const parentActor = (req: FastifyRequest): Actor => {
  const p = requireParent(req);
  return { type: 'parent', id: p.familyId, name: `הורה: ${p.parentName}`, ip: req.ip };
};

/**
 * Authenticates routes declared with access PARENT, using the parent cookie only.
 * Order: session (401) → idle timeout (401) → CSRF (403).
 */
export function registerParentAuth(app: FastifyInstance) {
  app.decorateRequest('parent', null);

  app.addHook('preValidation', async (req) => {
    const access = req.routeOptions.config?.access;
    if (!req.url.startsWith('/api/') || req.is404 || access?.type !== 'parent') return;
    const { db, clock, config } = app.deps;
    const token = req.cookies[parentCookie(config.COOKIE_SECURE)];
    if (!token) throw unauthorized('יש להתחבר לפורטל ההורים');
    const s = await db.parentSession.findUnique({ where: { tokenHash: sha256(token) } });
    const now = clock.now();
    if (!s || s.revokedAt || s.expiresAt <= now) throw unauthorized('יש להתחבר לפורטל ההורים');
    if (now.getTime() - s.lastSeenAt.getTime() > PARENT_IDLE_MINUTES * 60_000) {
      await db.parentSession.update({ where: { id: s.id }, data: { revokedAt: now } });
      throw new AppError(401, 'idle_timeout', 'החיבור נותק עקב חוסר פעילות. יש להתחבר מחדש');
    }
    const f = await db.family.findUnique({ where: { id: s.familyId } });
    if (!f || f.archivedAt) throw unauthorized('יש להתחבר לפורטל ההורים');
    req.parent = { sessionId: s.id, familyId: s.familyId, parentName: f.parentName, csrfToken: s.csrfToken };

    if (UNSAFE.has(req.method)) {
      const h = req.headers['x-csrf-token'];
      if (typeof h !== 'string' || !safeEqual(h, s.csrfToken)) {
        throw new AppError(403, 'csrf', 'פג תוקף הטופס. רעננו את הדף ונסו שוב');
      }
    }
    if (now.getTime() - s.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
      await db.parentSession.update({ where: { id: s.id }, data: { lastSeenAt: now } });
    }
  });
}
