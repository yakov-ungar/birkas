import type { FastifyInstance } from 'fastify';
import {
  normalizePhone,
  portalLoginStartSchema,
  portalLoginVerifySchema,
  type PortalLoginStart,
} from '@tuition/shared';
import { PARENT, PUBLIC } from '../../plugins/access';
import { parentActor, requireParent } from '../../plugins/parent';
import { badRequest, parse, unauthorized } from '../../lib/errors';
import { safeEqual, sha256 } from '../../lib/crypto';
import { recordAudit } from '../audit/service';
import { getSettings } from '../settings/service';
import {
  OTP_MAX_ATTEMPTS,
  OTP_MINUTES,
  OTP_PER_FAMILY,
  OTP_WINDOW_MINUTES,
  clearParentCookies,
  createParentSession,
  deviceCookie,
  maskContact,
  newChallengeId,
  newOtpCode,
  otpHash,
  rememberDevice,
  verifyPortalLink,
} from './session';

const startLimit = { max: 10, timeWindow: '15 minutes' };
const verifyLimit = { max: 20, timeWindow: '15 minutes' };
export const PORTAL_LIMIT = { max: 120, timeWindow: '1 minute' };

const WRONG_CODE = 'הקוד שגוי או שפג תוקפו';

export async function portalAuthRoutes(app: FastifyInstance) {
  const deps = app.deps;
  const { db, clock } = deps;

  /** Which channels the sign-in screen may offer (stage 9: email only unless text messaging is on). */
  app.get('/api/portal/login/options', { config: { access: PUBLIC, rateLimit: PORTAL_LIMIT } }, async () => ({
    textMessaging: (await getSettings(db)).textMessaging,
  }));

  /**
   * Sends a one-time code to the phone or email registered with the family.
   * The answer is the same whether or not the details match a family (no enumeration).
   */
  app.post(
    '/api/portal/login/start',
    { config: { access: PUBLIC, rateLimit: startLimit } },
    async (req): Promise<PortalLoginStart> => {
      const input = parse(portalLoginStartSchema, req.body);
      const now = clock.now();
      let familyId: string | null = null;
      let channel: 'sms' | 'email' = 'sms';
      if (input.link) {
        familyId = verifyPortalLink(deps, input.link, now);
        if (!familyId) throw badRequest('הקישור אינו בתוקף. אפשר להתחבר עם מספר הטלפון או המייל');
        channel = input.channel ?? 'sms';
      } else {
        const contact = input.contact!;
        const isEmail = contact.includes('@');
        channel = isEmail ? 'email' : 'sms';
        const f = await db.family.findFirst({
          where: {
            archivedAt: null,
            students: { some: { deletedAt: null } },
            ...(isEmail ? { email: contact.trim().toLowerCase() } : { phoneNorm: normalizePhone(contact) }),
          },
          orderBy: { createdAt: 'asc' },
        });
        familyId = f?.id ?? null;
      }

      const challengeId = newChallengeId();
      const f = familyId ? await db.family.findFirst({ where: { id: familyId, archivedAt: null } }) : null;
      if (!f) return { challengeId, sentTo: null };
      const { textMessaging } = await getSettings(db);
      if (!textMessaging) {
        // Stage 9: email only. A typed phone number finds the family; the code goes to its email.
        channel = 'email';
        if (!f.email && input.link)
          throw badRequest('לא רשומה כתובת מייל למשפחה. יש לפנות למזכירות בית הספר');
      } else if (channel === 'email' && !f.email) channel = 'sms';
      const to = channel === 'email' ? f.email : normalizePhone(f.phone);
      const recent = await db.parentOtp.count({
        where: { familyId: f.id, createdAt: { gte: new Date(now.getTime() - OTP_WINDOW_MINUTES * 60_000) } },
      });
      if (to && recent < OTP_PER_FAMILY) {
        const code = newOtpCode();
        await db.parentOtp.create({
          data: {
            id: challengeId,
            familyId: f.id,
            channel,
            codeHash: otpHash(deps, challengeId, code),
            expiresAt: new Date(now.getTime() + OTP_MINUTES * 60_000),
            ip: req.ip,
            createdAt: now,
          },
        });
        const { schoolName } = await getSettings(db);
        const text = `קוד הכניסה לפורטל ההורים של ${schoolName}: ${code}\nהקוד בתוקף ${OTP_MINUTES} דקות. אין למסור אותו לאיש.`;
        // Sent directly, not through the message queue: the code must not be kept in message history.
        if (channel === 'email') await deps.mailer.send({ to, subject: 'קוד כניסה לפורטל ההורים', text });
        else {
          const r = await deps.texts.sms.send(to, text);
          if (!r.ok) req.log.warn({ familyId: f.id }, 'portal code sms failed');
        }
      }
      return { challengeId, sentTo: input.link && to ? maskContact(to) : null };
    },
  );

  app.post(
    '/api/portal/login/verify',
    { config: { access: PUBLIC, rateLimit: verifyLimit } },
    async (req, reply) => {
      const { challengeId, code, trustDevice } = parse(portalLoginVerifySchema, req.body);
      const now = clock.now();
      const fail = () => badRequest(WRONG_CODE, { code: WRONG_CODE });
      const otp = await db.parentOtp.findUnique({ where: { id: challengeId } });
      if (!otp || otp.usedAt || otp.expiresAt <= now || otp.attempts >= OTP_MAX_ATTEMPTS) throw fail();
      if (!safeEqual(otp.codeHash, otpHash(deps, challengeId, code))) {
        await db.parentOtp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
        throw fail();
      }
      // Single use, even under concurrent requests.
      const used = await db.parentOtp.updateMany({
        where: { id: otp.id, usedAt: null },
        data: { usedAt: now },
      });
      if (used.count !== 1) throw fail();
      const f = await db.family.findFirst({ where: { id: otp.familyId, archivedAt: null } });
      if (!f) throw fail();
      await createParentSession(deps, req, reply, f.id);
      if (trustDevice) await rememberDevice(deps, reply, f.id);
      await db.$transaction((tx) =>
        recordAudit(tx, { type: 'parent', id: f.id, name: `הורה: ${f.parentName}`, ip: req.ip }, now, {
          action: 'portal.login',
          summary: `כניסה לפורטל ההורים (${otp.channel === 'email' ? 'מייל' : 'SMS'}) של ${f.name}`,
          entity: 'Family',
          entityId: f.id,
        }),
      );
      return { ok: true };
    },
  );

  /** Back in without a new code on a device the parent chose to remember (decision C15). */
  app.post(
    '/api/portal/login/device',
    { config: { access: PUBLIC, rateLimit: verifyLimit } },
    async (req, reply) => {
      const token = req.cookies[deviceCookie(deps.config.COOKIE_SECURE)];
      if (!token) throw unauthorized('יש להתחבר לפורטל ההורים');
      const now = clock.now();
      const d = await db.parentDevice.findUnique({ where: { tokenHash: sha256(token) } });
      const f = d ? await db.family.findFirst({ where: { id: d.familyId, archivedAt: null } }) : null;
      if (!d || !f || d.revokedAt || d.expiresAt <= now) {
        clearParentCookies(deps, reply, true);
        throw unauthorized('יש להתחבר לפורטל ההורים');
      }
      await db.parentDevice.update({ where: { id: d.id }, data: { lastUsedAt: now } });
      await createParentSession(deps, req, reply, f.id);
      return { ok: true };
    },
  );

  app.post(
    '/api/portal/logout',
    { config: { access: PARENT, rateLimit: PORTAL_LIMIT } },
    async (req, reply) => {
      const p = requireParent(req);
      const now = clock.now();
      await db.parentSession.update({ where: { id: p.sessionId }, data: { revokedAt: now } });
      const token = req.cookies[deviceCookie(deps.config.COOKIE_SECURE)];
      if (token)
        await db.parentDevice.updateMany({
          where: { tokenHash: sha256(token), familyId: p.familyId, revokedAt: null },
          data: { revokedAt: now },
        });
      clearParentCookies(deps, reply, true);
      await db.$transaction((tx) =>
        recordAudit(tx, parentActor(req), now, {
          action: 'portal.logout',
          summary: 'יציאה מפורטל ההורים',
          entity: 'Family',
          entityId: p.familyId,
        }),
      );
      return { ok: true };
    },
  );
}
