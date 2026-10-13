import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SessionStage } from '@tuition/shared';
import type { Deps } from '../../deps';
import { randomToken, sha256 } from '../../lib/crypto';

export const ABSOLUTE_SESSION_HOURS = 12;
export const PENDING_SESSION_MINUTES = 10;

export const cookieName = (secure: boolean) => (secure ? '__Host-sid' : 'sid');

export async function createSession(
  deps: Deps,
  req: FastifyRequest,
  reply: FastifyReply,
  userId: string,
  stage: SessionStage,
) {
  const token = randomToken();
  const now = deps.clock.now();
  const expiresAt =
    stage === 'full'
      ? new Date(now.getTime() + ABSOLUTE_SESSION_HOURS * 3600_000)
      : new Date(now.getTime() + PENDING_SESSION_MINUTES * 60_000);
  const session = await deps.db.session.create({
    data: {
      tokenHash: sha256(token),
      userId,
      stage,
      csrfToken: randomToken(24),
      lastSeenAt: now,
      expiresAt,
      ip: req.ip,
      userAgent: (req.headers['user-agent'] ?? '').slice(0, 300),
    },
  });
  reply.setCookie(cookieName(deps.config.COOKIE_SECURE), token, {
    httpOnly: true,
    secure: deps.config.COOKIE_SECURE,
    sameSite: 'strict',
    path: '/',
    expires: expiresAt,
  });
  return session;
}

/** Issues a fresh token when privilege changes (prevents session fixation). */
export async function upgradeSession(
  deps: Deps,
  req: FastifyRequest,
  reply: FastifyReply,
  oldSessionId: string,
  userId: string,
) {
  await deps.db.session.update({ where: { id: oldSessionId }, data: { revokedAt: deps.clock.now() } });
  return createSession(deps, req, reply, userId, 'full');
}

export function clearSessionCookie(deps: Deps, reply: FastifyReply) {
  reply.clearCookie(cookieName(deps.config.COOKIE_SECURE), {
    path: '/',
    secure: deps.config.COOKIE_SECURE,
    httpOnly: true,
    sameSite: 'strict',
  });
}
