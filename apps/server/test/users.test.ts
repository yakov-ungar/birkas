import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ROLES } from '@tuition/shared';
import { Agent, createUser, makeApp, signedIn, type TestCtx } from './helpers';

let ctx: TestCtx;
beforeEach(async () => {
  ctx = await makeApp();
});
afterEach(() => ctx.close());

const inviteToken = async (email: string) => {
  const mail = await ctx.deps.db.outbox.findFirstOrThrow({
    where: { to: email },
    orderBy: { createdAt: 'desc' },
  });
  return /#token=([\w-]+)/.exec(mail.text)![1]!;
};

describe('users', () => {
  it('creates a user with role defaults and emails a one-time invite', async () => {
    const { agent } = await signedIn(ctx);
    const r = await agent.req('POST', '/api/users', {
      name: 'קופאית חדשה',
      email: 'Cash2@School.test',
      role: 'קופאית',
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().user).toMatchObject({ email: 'cash2@school.test', role: 'קופאית', status: 'invited' });
    expect(r.json().user.permissions).toEqual([...ROLES['קופאית']!]);

    const mail = await ctx.deps.db.outbox.findFirstOrThrow({ where: { to: 'cash2@school.test' } });
    expect(mail.subject).toContain('הזמנה');
    const token = await inviteToken('cash2@school.test');

    const anon = new Agent(ctx.app);
    expect((await anon.req('POST', '/api/auth/invite/check', { token })).json().name).toBe('קופאית חדשה');
    const short = await anon.req('POST', '/api/auth/invite/accept', { token, password: 'short123' });
    expect(short.statusCode).toBe(400);
    expect(short.json().error.message).toContain('לפחות 10');
    expect(
      (await anon.req('POST', '/api/auth/invite/accept', { token, password: 'Long-Enough-Pass-1' }))
        .statusCode,
    ).toBe(200);
    // One-time
    expect(
      (await anon.req('POST', '/api/auth/invite/accept', { token, password: 'Long-Enough-Pass-1' }))
        .statusCode,
    ).toBe(400);

    const login = await anon.req('POST', '/api/auth/login', {
      email: 'cash2@school.test',
      password: 'Long-Enough-Pass-1',
    });
    expect(login.json().stage).toBe('setup_2fa');
  });

  it('expires invites after 72 hours', async () => {
    const { agent } = await signedIn(ctx);
    await agent.req('POST', '/api/users', { name: 'א', email: 'late@school.test', role: 'צפייה בלבד' });
    const token = await inviteToken('late@school.test');
    ctx.deps.clock.advanceMinutes(73 * 60);
    const r = await new Agent(ctx.app).req('POST', '/api/auth/invite/check', { token });
    expect(r.statusCode).toBe(400);
  });

  it('refuses a duplicate email', async () => {
    const { agent, user } = await signedIn(ctx);
    const r = await agent.req('POST', '/api/users', { name: 'כפול', email: user.email, role: 'קופאית' });
    expect(r.statusCode).toBe(409);
  });

  it('marks a user with edited permissions as custom, and back to a role on exact match', async () => {
    const { agent } = await signedIn(ctx);
    const { user } = await createUser(ctx.deps, { permissions: [...ROLES['קופאית']!] });
    const r1 = await agent.req('PATCH', `/api/users/${user.id}`, { permissions: ['stu_view', 'pay'] });
    expect(r1.json().user.role).toBe('מותאם אישית');
    const r2 = await agent.req('PATCH', `/api/users/${user.id}`, { role: 'גבייה' });
    expect(r2.json().user.role).toBe('גבייה');
    expect(r2.json().user.permissions).toEqual([...ROLES['גבייה']!]);
  });

  it('does not let you disable yourself or drop your own user management', async () => {
    const { agent, user } = await signedIn(ctx);
    await createUser(ctx.deps); // another admin exists
    const r1 = await agent.req('PATCH', `/api/users/${user.id}`, { active: false });
    expect(r1.statusCode).toBe(400);
    expect(r1.json().error.message).toBe('אי אפשר להסיר מעצמך ניהול משתמשים או להשבית את עצמך');
    const r2 = await agent.req('PATCH', `/api/users/${user.id}`, { role: 'קופאית' });
    expect(r2.statusCode).toBe(400);
  });

  it('keeps at least one active administrator', async () => {
    // The acting user always holds "users", so the last-admin guard is reached through self-changes;
    // it is checked independently of the self rule as defense in depth.
    const { agent, user: me } = await signedIn(ctx);
    const { user: other } = await createUser(ctx.deps);
    expect((await agent.req('PATCH', `/api/users/${other.id}`, { active: false })).statusCode).toBe(200);
    // I am now the only active administrator.
    const r = await agent.req('PATCH', `/api/users/${me.id}`, { permissions: ['stu_view'] });
    expect(r.statusCode).toBe(400);
    const stillAdmin = await ctx.deps.db.user.findUniqueOrThrow({ where: { id: me.id } });
    expect(JSON.parse(stillAdmin.permissions)).toContain('users');
  });

  it('revokes sessions of a disabled user immediately', async () => {
    const { agent } = await signedIn(ctx);
    const { agent: victim, user } = await signedIn(ctx, ['stu_view']);
    expect((await victim.req('GET', '/api/auth/me')).statusCode).toBe(200);
    await agent.req('PATCH', `/api/users/${user.id}`, { active: false });
    expect((await victim.req('GET', '/api/auth/me')).statusCode).toBe(401);
  });

  it('applies permission changes to existing sessions', async () => {
    const { agent } = await signedIn(ctx);
    const { agent: u2, user } = await signedIn(ctx, ['stu_view', 'users']);
    expect((await u2.req('GET', '/api/users')).statusCode).toBe(200);
    await agent.req('PATCH', `/api/users/${user.id}`, { permissions: ['stu_view'] });
    expect((await u2.req('GET', '/api/users')).statusCode).toBe(403);
  });

  it('writes every change to the audit log with before and after', async () => {
    const { agent } = await signedIn(ctx);
    const { user } = await createUser(ctx.deps, { permissions: [...ROLES['קופאית']!] });
    await agent.req('PATCH', `/api/users/${user.id}`, { active: false });
    const row = await ctx.deps.db.auditLog.findFirstOrThrow({
      where: { action: 'user.update', entityId: user.id },
    });
    expect(JSON.parse(row.before!).active).toBe(true);
    expect(JSON.parse(row.after!).active).toBe(false);
    expect(row.summary).toContain('הושבת משתמש');
    expect(row.before).not.toContain('passwordHash');
  });
});
