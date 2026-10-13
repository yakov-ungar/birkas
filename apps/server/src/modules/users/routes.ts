import type { FastifyInstance } from 'fastify';
import {
  ROLES,
  normalizePermissions,
  roleFor,
  userCreateSchema,
  userUpdateSchema,
  type Permission,
  type UserRow,
} from '@tuition/shared';
import type { User } from '@prisma/client';
import { z } from 'zod';
import { staff } from '../../plugins/access';
import { actorOf, requireAuth } from '../../plugins/auth';
import { badRequest, conflict, notFound, parse } from '../../lib/errors';
import { randomToken, sha256 } from '../../lib/crypto';
import { recordAudit } from '../audit/service';
import { getSettings } from '../settings/service';
import type { Deps } from '../../deps';
import type { Tx } from '../../lib/db';

const INVITE_HOURS = 72;
const idParam = z.object({ id: z.string().min(1).max(40) });

const perms = (u: Pick<User, 'permissions'>) => normalizePermissions(JSON.parse(u.permissions) as string[]);

function toRow(u: User, now: Date): UserRow {
  const status: UserRow['status'] = !u.active
    ? 'disabled'
    : !u.passwordHash
      ? 'invited'
      : u.lockedUntil && u.lockedUntil > now
        ? 'locked'
        : 'active';
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    permissions: perms(u),
    active: u.active,
    status,
    has2fa: !!u.totpEnabledAt,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
  };
}

const publicUser = (u: User) => ({
  name: u.name,
  email: u.email,
  role: u.role,
  permissions: perms(u),
  active: u.active,
});

/** Creates a one-time invite link and emails it. The token is only ever stored hashed. */
export async function issueInvite(deps: Deps, tx: Tx, user: Pick<User, 'id' | 'name' | 'email'>) {
  const token = randomToken();
  const now = deps.clock.now();
  await tx.userInvite.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } });
  await tx.userInvite.create({
    data: {
      userId: user.id,
      tokenHash: sha256(token),
      expiresAt: new Date(now.getTime() + INVITE_HOURS * 3600_000),
    },
  });
  const { schoolName } = await getSettings(tx);
  // Token in the URL fragment: browsers never send it to the server or in Referer headers.
  const link = `${deps.config.APP_BASE_URL}/invite#token=${token}`;
  return {
    link,
    mail: {
      to: user.email,
      subject: `הזמנה למערכת הגבייה - ${schoolName}`,
      text: [
        `שלום ${user.name},`,
        '',
        `נפתח עבורך משתמש במערכת הגבייה של ${schoolName}.`,
        'להגדרת סיסמה ואימות דו-שלבי יש להיכנס לקישור הבא:',
        link,
        '',
        `הקישור תקף ל-${INVITE_HOURS} שעות ולשימוש חד-פעמי.`,
        'אם לא ציפית להודעה זו, אפשר להתעלם ממנה.',
      ].join('\n'),
    },
  };
}

/** True when, after the change, at least one active user still holds the "users" permission. */
async function adminRemains(tx: Tx, changedId: string, next: { active: boolean; permissions: Permission[] }) {
  if (next.active && next.permissions.includes('users')) return true;
  const others = await tx.user.findMany({
    where: { active: true, id: { not: changedId } },
    select: { permissions: true },
  });
  return others.some((o) => perms(o).includes('users'));
}

export async function userRoutes(app: FastifyInstance) {
  const deps = app.deps;
  const { db, clock } = deps;

  app.get('/api/users', { config: { access: staff('users') } }, async () => {
    const users = await db.user.findMany({ orderBy: { createdAt: 'asc' } });
    const now = clock.now();
    return { users: users.map((u) => toRow(u, now)) };
  });

  app.post('/api/users', { config: { access: staff('users') } }, async (req) => {
    const input = parse(userCreateSchema, req.body);
    const now = clock.now();
    if (await db.user.findUnique({ where: { email: input.email } })) {
      throw conflict('כתובת האימייל כבר קיימת במערכת');
    }
    const permissions = [...(ROLES[input.role] ?? [])];
    const { user, mail } = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: input.name,
          email: input.email,
          role: input.role,
          permissions: JSON.stringify(permissions),
        },
      });
      const { mail } = await issueInvite(deps, tx, user);
      await recordAudit(tx, actorOf(req), now, {
        action: 'user.create',
        summary: `נוצר משתמש: ${user.name} (${user.role})`,
        entity: 'User',
        entityId: user.id,
        after: publicUser(user),
      });
      return { user, mail };
    });
    await deps.mailer.send(mail);
    return { user: toRow(user, now) };
  });

  app.patch('/api/users/:id', { config: { access: staff('users') } }, async (req) => {
    const auth = requireAuth(req);
    const { id } = parse(idParam, req.params);
    const input = parse(userUpdateSchema, req.body);
    const now = clock.now();

    const updated = await db.$transaction(async (tx) => {
      const u = await tx.user.findUnique({ where: { id } });
      if (!u) throw notFound('המשתמש לא נמצא');

      let permissions = perms(u);
      if (input.permissions) permissions = normalizePermissions(input.permissions);
      else if (input.role && ROLES[input.role]) permissions = [...ROLES[input.role]!];
      const active = input.active ?? u.active;
      const role = roleFor(permissions, input.role ?? u.role);

      if (id === auth.user.id && (!permissions.includes('users') || !active)) {
        throw badRequest('אי אפשר להסיר מעצמך ניהול משתמשים או להשבית את עצמך');
      }
      if (!(await adminRemains(tx, id, { active, permissions }))) {
        throw badRequest('חייב להישאר לפחות מנהל פעיל אחד');
      }

      const next = await tx.user.update({
        where: { id },
        data: { permissions: JSON.stringify(permissions), active, role },
      });
      if (!active && u.active) {
        await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: now } });
      }
      const what =
        !active && u.active ? 'הושבת משתמש' : active && !u.active ? 'הופעל משתמש' : 'עודכנו הרשאות';
      await recordAudit(tx, actorOf(req), now, {
        action: 'user.update',
        summary: `${what}: ${u.name}`,
        entity: 'User',
        entityId: id,
        before: publicUser(u),
        after: publicUser(next),
      });
      return next;
    });
    return { user: toRow(updated, now) };
  });

  app.post('/api/users/:id/invite', { config: { access: staff('users') } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const now = clock.now();
    const mail = await db.$transaction(async (tx) => {
      const u = await tx.user.findUnique({ where: { id } });
      if (!u) throw notFound('המשתמש לא נמצא');
      if (u.passwordHash) throw conflict('המשתמש כבר הגדיר סיסמה');
      if (!u.active) throw conflict('המשתמש מושבת');
      const { mail } = await issueInvite(deps, tx, u);
      await recordAudit(tx, actorOf(req), now, {
        action: 'user.invite_resent',
        summary: `נשלחה הזמנה מחדש: ${u.name}`,
        entity: 'User',
        entityId: id,
      });
      return mail;
    });
    await deps.mailer.send(mail);
    return { ok: true };
  });
}
