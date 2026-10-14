import { createHmac, randomInt } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Deps } from '../../deps';
import { randomToken, safeEqual, sha256 } from '../../lib/crypto';

/** Decision C15: 15 minutes idle; the device can be remembered for 30 days. */
export const PARENT_IDLE_MINUTES = 15;
export const PARENT_SESSION_HOURS = 12;
export const DEVICE_DAYS = 30;
export const OTP_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
/** At most this many codes per family in OTP_WINDOW_MINUTES, whatever the IP. */
export const OTP_PER_FAMILY = 3;
export const OTP_WINDOW_MINUTES = 15;
export const LINK_DAYS = 7;

// Separate names from the staff cookie (__Host-sid): a staff session never opens the portal and vice versa.
export const parentCookie = (secure: boolean) => (secure ? '__Host-psid' : 'psid');
export const deviceCookie = (secure: boolean) => (secure ? '__Host-pdev' : 'pdev');

const keyFor = (deps: Deps, purpose: string) =>
  createHmac('sha256', Buffer.from(deps.config.APP_ENCRYPTION_KEY, 'base64')).update(purpose).digest();

const hmac = (deps: Deps, purpose: string, data: string) =>
  createHmac('sha256', keyFor(deps, purpose)).update(data).digest('base64url');

// ---------- one-time codes ----------

export const newOtpCode = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

/** Keyed hash: a leaked table does not let anyone try all million codes offline. */
export const otpHash = (deps: Deps, challengeId: string, code: string) =>
  hmac(deps, 'parent-otp', `${challengeId}:${code}`);

export const newChallengeId = () => randomToken(18);

// ---------- signed portal link ({קישור}) ----------

export function signPortalLink(deps: Deps, familyId: string, now: Date): string {
  const exp = Math.floor(now.getTime() / 1000) + LINK_DAYS * 86_400;
  const body = `${familyId}.${exp}`;
  return `${body}.${hmac(deps, 'portal-link', body)}`;
}

/** Returns the family id of a valid, unexpired link token, or null. */
export function verifyPortalLink(deps: Deps, token: string, now: Date): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [familyId, exp, sig] = parts as [string, string, string];
  if (!/^[a-z0-9]{1,40}$/i.test(familyId) || !/^\d{1,12}$/.test(exp)) return null;
  if (!safeEqual(sig, hmac(deps, 'portal-link', `${familyId}.${exp}`))) return null;
  if (Number(exp) * 1000 < now.getTime()) return null;
  return familyId;
}

// ---------- sessions ----------

const cookieOpts = (deps: Deps, sameSite: 'lax' | 'strict', expires?: Date) => ({
  httpOnly: true,
  secure: deps.config.COOKIE_SECURE,
  // Lax for the session so a link from an SMS opens the portal signed in (plan: security table).
  sameSite,
  path: '/',
  ...(expires ? { expires } : {}),
});

export async function createParentSession(
  deps: Deps,
  req: FastifyRequest,
  reply: FastifyReply,
  familyId: string,
) {
  const token = randomToken();
  const now = deps.clock.now();
  const expiresAt = new Date(now.getTime() + PARENT_SESSION_HOURS * 3600_000);
  await deps.db.parentSession.create({
    data: {
      tokenHash: sha256(token),
      familyId,
      csrfToken: randomToken(24),
      createdAt: now,
      lastSeenAt: now,
      expiresAt,
      ip: req.ip,
      userAgent: (req.headers['user-agent'] ?? '').slice(0, 300),
    },
  });
  reply.setCookie(parentCookie(deps.config.COOKIE_SECURE), token, cookieOpts(deps, 'lax', expiresAt));
}

export async function rememberDevice(deps: Deps, reply: FastifyReply, familyId: string) {
  const token = randomToken();
  const now = deps.clock.now();
  const expiresAt = new Date(now.getTime() + DEVICE_DAYS * 86_400_000);
  await deps.db.parentDevice.create({
    data: { tokenHash: sha256(token), familyId, createdAt: now, lastUsedAt: now, expiresAt },
  });
  reply.setCookie(deviceCookie(deps.config.COOKIE_SECURE), token, cookieOpts(deps, 'strict', expiresAt));
}

export function clearParentCookies(deps: Deps, reply: FastifyReply, device: boolean) {
  reply.clearCookie(parentCookie(deps.config.COOKIE_SECURE), cookieOpts(deps, 'lax'));
  if (device) reply.clearCookie(deviceCookie(deps.config.COOKIE_SECURE), cookieOpts(deps, 'strict'));
}

/** "05x-xxx1234" → "******1234"; "dana@example.com" → "d***@example.com". */
export function maskContact(v: string): string {
  if (v.includes('@')) {
    const [u, d] = v.split('@') as [string, string];
    return `${u.slice(0, 1)}***@${d}`;
  }
  const digits = v.replace(/\D/g, '');
  return `${'*'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}
