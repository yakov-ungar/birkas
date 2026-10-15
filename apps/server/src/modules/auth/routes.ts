import type { FastifyInstance } from 'fastify';
import {
  inviteAcceptSchema,
  inviteTokenSchema,
  loginSchema,
  normalizePermissions,
  totpCodeSchema,
  type MeResponse,
  type SessionStage,
} from '@tuition/shared';
import { PUBLIC, preAuth, staff } from '../../plugins/access';
import { requireAuth } from '../../plugins/auth';
import { AppError, badRequest, conflict, parse, unauthorized } from '../../lib/errors';
import { hashPassword, passwordProblem, verifyPassword } from '../../lib/passwords';
import { checkTotp, newTotpSecret, totpQr } from '../../lib/totp';
import { randomToken, sha256 } from '../../lib/crypto';
import { getSettings } from '../settings/service';
import { israelDate } from '../../lib/clock';
import { recordAudit } from '../audit/service';
import { clearSessionCookie, createSession, upgradeSession } from './session';

const LOCK_MINUTES = 15;
const RECOVERY_CODES = 10;
const GENERIC_FAIL = 'אימייל או סיסמה שגויים';

export async function authRoutes(app: FastifyInstance) {
  const deps = app.deps;
  const { db, clock } = deps;
  const loginLimit = { max: deps.config.LOGIN_RATE_LIMIT, timeWindow: '15 minutes' };

  const event = (userId: string | null, ev: string, req: { ip: string; headers: Record<string, unknown> }) =>
    db.loginEvent.create({
      data: {
        at: clock.now(),
        userId,
        event: ev,
        ip: req.ip,
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
      },
    });

  /** Counts a failed password or 2FA attempt and locks the user once the configured limit is reached. */
  async function registerFailure(userId: string) {
    const { maxFailedLogins } = await getSettings(db);
    const u = await db.user.update({ where: { id: userId }, data: { failedLogins: { increment: 1 } } });
    if (u.failedLogins >= maxFailedLogins) {
      await db.user.update({
        where: { id: userId },
        data: { failedLogins: 0, lockedUntil: new Date(clock.now().getTime() + LOCK_MINUTES * 60_000) },
      });
      return true;
    }
    return false;
  }

  const lockedError = () =>
    new AppError(423, 'locked', `המשתמש ננעל זמנית עקב ניסיונות כושלים. נסו שוב בעוד ${LOCK_MINUTES} דקות`);

  app.post('/api/auth/login', { config: { access: PUBLIC, rateLimit: loginLimit } }, async (req, reply) => {
    const { email, password } = parse(loginSchema, req.body);
    const user = await db.user.findUnique({ where: { email } });
    const now = clock.now();
    if (user?.lockedUntil && user.lockedUntil > now) {
      await event(user.id, 'locked', req);
      throw lockedError();
    }
    const ok = await verifyPassword(user?.passwordHash, password);
    if (!user || !ok || !user.active) {
      if (user) {
        await event(user.id, 'fail', req);
        if (user.active && user.passwordHash && (await registerFailure(user.id))) throw lockedError();
      } else {
        await event(null, 'fail', req);
      }
      throw unauthorized(GENERIC_FAIL);
    }

    const { require2fa } = await getSettings(db);
    const stage: SessionStage = user.totpEnabledAt ? 'pending_2fa' : require2fa ? 'setup_2fa' : 'full';
    await db.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null, ...(stage === 'full' ? { lastLoginAt: now } : {}) },
    });
    await createSession(deps, req, reply, user.id, stage);
    await event(user.id, stage === 'full' ? 'success' : 'password_ok', req);
    return { stage };
  });

  app.post(
    '/api/auth/2fa/verify',
    { config: { access: preAuth('pending_2fa'), rateLimit: loginLimit } },
    async (req, reply) => {
      const auth = requireAuth(req);
      const { code } = parse(totpCodeSchema, req.body);
      const user = await db.user.findUniqueOrThrow({ where: { id: auth.user.id } });
      const now = clock.now();
      if (user.lockedUntil && user.lockedUntil > now) throw lockedError();

      let ok = false;
      const clean = code.replace(/\s/g, '');
      if (/^\d{6}$/.test(clean) && user.totpSecretEnc) {
        const step = checkTotp(deps.enc.decrypt(user.totpSecretEnc), clean, now);
        if (step !== null && (user.totpLastStep === null || step > user.totpLastStep)) {
          await db.user.update({ where: { id: user.id }, data: { totpLastStep: step } });
          ok = true;
        }
      } else {
        const hash = sha256(clean.toUpperCase().replace(/-/g, ''));
        const rc = await db.recoveryCode.findFirst({
          where: { userId: user.id, codeHash: hash, usedAt: null },
        });
        if (rc) {
          await db.recoveryCode.update({ where: { id: rc.id }, data: { usedAt: now } });
          ok = true;
        }
      }

      if (!ok) {
        await event(user.id, '2fa_fail', req);
        if (await registerFailure(user.id)) {
          await db.session.update({ where: { id: auth.sessionId }, data: { revokedAt: now } });
          throw lockedError();
        }
        throw badRequest('הקוד שגוי או שפג תוקפו', { code: 'הקוד שגוי' });
      }
      await db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lastLoginAt: now } });
      await upgradeSession(deps, req, reply, auth.sessionId, user.id);
      await event(user.id, 'success', req);
      return { stage: 'full' };
    },
  );

  /** Starts (or restarts) 2FA enrollment. The secret becomes active only after /2fa/enable. */
  app.post('/api/auth/2fa/setup', { config: { access: preAuth('setup_2fa', 'full') } }, async (req) => {
    const auth = requireAuth(req);
    const user = await db.user.findUniqueOrThrow({ where: { id: auth.user.id } });
    if (user.totpEnabledAt) throw conflict('אימות דו-שלבי כבר מוגדר למשתמש זה');
    const secret = newTotpSecret();
    await db.user.update({ where: { id: user.id }, data: { totpSecretEnc: deps.enc.encrypt(secret) } });
    const { schoolName } = await getSettings(db);
    const { uri, qrDataUrl } = await totpQr(secret, user.email, schoolName);
    return { qrDataUrl, otpauthUri: uri, secret };
  });

  app.post(
    '/api/auth/2fa/enable',
    { config: { access: preAuth('setup_2fa', 'full') } },
    async (req, reply) => {
      const auth = requireAuth(req);
      const { code } = parse(totpCodeSchema, req.body);
      const user = await db.user.findUniqueOrThrow({ where: { id: auth.user.id } });
      if (user.totpEnabledAt) throw conflict('אימות דו-שלבי כבר מוגדר למשתמש זה');
      if (!user.totpSecretEnc) throw badRequest('יש להתחיל את הגדרת האימות מחדש');
      const now = clock.now();
      const step = checkTotp(deps.enc.decrypt(user.totpSecretEnc), code.trim(), now);
      if (step === null) throw badRequest('הקוד שגוי. ודאו שהשעון בטלפון מכוון', { code: 'הקוד שגוי' });

      const codes = Array.from({ length: RECOVERY_CODES }, () => {
        const raw = randomToken(8)
          .replace(/[^A-Za-z0-9]/g, '')
          .toUpperCase()
          .padEnd(10, 'X')
          .slice(0, 10);
        return `${raw.slice(0, 5)}-${raw.slice(5)}`;
      });
      await db.$transaction(async (tx) => {
        await tx.user.update({ where: { id: user.id }, data: { totpEnabledAt: now, totpLastStep: step } });
        await tx.recoveryCode.deleteMany({ where: { userId: user.id } });
        await tx.recoveryCode.createMany({
          data: codes.map((c) => ({ userId: user.id, codeHash: sha256(c.replace('-', '')) })),
        });
        await recordAudit(tx, { type: 'user', id: user.id, name: user.name, ip: req.ip }, now, {
          action: 'user.2fa_enabled',
          summary: 'הוגדר אימות דו-שלבי',
          entity: 'User',
          entityId: user.id,
        });
      });
      if (auth.stage === 'setup_2fa') {
        await db.user.update({ where: { id: user.id }, data: { lastLoginAt: now } });
        await upgradeSession(deps, req, reply, auth.sessionId, user.id);
        await event(user.id, 'success', req);
      }
      return { recoveryCodes: codes };
    },
  );

  app.post(
    '/api/auth/logout',
    { config: { access: preAuth('pending_2fa', 'setup_2fa', 'full') } },
    async (req, reply) => {
      const auth = requireAuth(req);
      await db.session.update({ where: { id: auth.sessionId }, data: { revokedAt: clock.now() } });
      await event(auth.user.id, 'logout', req);
      clearSessionCookie(deps, reply);
      return { ok: true };
    },
  );

  app.get(
    '/api/auth/me',
    { config: { access: preAuth('pending_2fa', 'setup_2fa', 'full') } },
    async (req) => {
      const auth = requireAuth(req);
      const s = await getSettings(db);
      const body: MeResponse = {
        stage: auth.stage,
        csrfToken: auth.csrfToken,
        user: { ...auth.user, permissions: normalizePermissions(auth.user.permissions) },
        school: {
          name: s.schoolName,
          yearName: s.activeYearName,
          grades: s.grades,
          textMessaging: s.textMessaging,
        },
        idleTimeoutMin: s.idleTimeoutMin,
        testMode: deps.config.ENABLE_TEST_ROUTES && deps.config.NODE_ENV !== 'production',
        today: israelDate(clock.now()),
      };
      return body;
    },
  );

  /** Lightweight keep-alive used by the client to show a warning before idle logout. */
  app.get('/api/auth/ping', { config: { access: staff() } }, async () => ({ ok: true }));

  // ---------- invites ----------
  async function findInvite(token: string) {
    const inv = await db.userInvite.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    if (!inv || inv.usedAt || inv.expiresAt <= clock.now() || !inv.user.active) {
      throw badRequest('קישור ההזמנה אינו תקף או שפג תוקפו. בקשו הזמנה חדשה ממנהל המערכת');
    }
    return inv;
  }

  // Token travels in the body (never the URL) so it does not end up in access logs.
  app.post(
    '/api/auth/invite/check',
    { config: { access: PUBLIC, rateLimit: { max: 30, timeWindow: '1 hour' } } },
    async (req) => {
      const { token } = parse(inviteTokenSchema, req.body);
      const inv = await findInvite(token);
      const { minPasswordLength } = await getSettings(db);
      return { name: inv.user.name, email: inv.user.email, minPasswordLength };
    },
  );

  app.post(
    '/api/auth/invite/accept',
    { config: { access: PUBLIC, rateLimit: { max: 30, timeWindow: '1 hour' } } },
    async (req) => {
      const { token, password } = parse(inviteAcceptSchema, req.body);
      const inv = await findInvite(token);
      const { minPasswordLength } = await getSettings(db);
      const problem = passwordProblem(password, minPasswordLength, inv.user.email);
      if (problem) throw badRequest(problem, { password: problem });
      const hash = await hashPassword(password);
      const now = clock.now();
      await db.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: inv.userId },
          data: { passwordHash: hash, failedLogins: 0, lockedUntil: null },
        });
        await tx.userInvite.update({ where: { id: inv.id }, data: { usedAt: now } });
        await recordAudit(tx, { type: 'user', id: inv.userId, name: inv.user.name, ip: req.ip }, now, {
          action: 'user.invite_accepted',
          summary: `המשתמש ${inv.user.name} הגדיר סיסמה`,
          entity: 'User',
          entityId: inv.userId,
        });
      });
      return { ok: true, email: inv.user.email };
    },
  );
}
