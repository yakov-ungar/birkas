import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Agent, createUser, makeApp, signedIn, totpNow, type TestCtx } from './helpers';

let ctx: TestCtx;
beforeEach(async () => {
  ctx = await makeApp();
});
afterEach(() => ctx.close());

describe('login', () => {
  it('requires 2FA after a correct password and grants a full session after the code', async () => {
    const { user, password, secret } = await createUser(ctx.deps);
    const a = new Agent(ctx.app);
    const r = await a.req('POST', '/api/auth/login', { email: user.email, password });
    expect(r.statusCode).toBe(200);
    expect(r.json().stage).toBe('pending_2fa');

    const cookie = r.cookies[0]!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe('Strict');

    // Pending session cannot reach staff routes.
    expect((await a.req('GET', '/api/users')).statusCode).toBe(401);

    await a.refreshCsrf();
    const v = await a.req('POST', '/api/auth/2fa/verify', { code: totpNow(secret!, ctx.deps.clock) });
    expect(v.statusCode).toBe(200);
    await a.refreshCsrf();
    expect((await a.req('GET', '/api/users')).statusCode).toBe(200);
  });

  it('returns the same Hebrew error for an unknown email and a wrong password', async () => {
    const { user } = await createUser(ctx.deps);
    const a = new Agent(ctx.app);
    const r1 = await a.req('POST', '/api/auth/login', {
      email: 'nobody@school.test',
      password: 'whatever-123',
    });
    const r2 = await a.req('POST', '/api/auth/login', { email: user.email, password: 'wrong-password' });
    expect(r1.statusCode).toBe(401);
    expect(r2.statusCode).toBe(401);
    expect(r1.json().error.message).toBe('אימייל או סיסמה שגויים');
    expect(r2.json().error.message).toBe(r1.json().error.message);
  });

  it('locks the user after the configured number of failures, and unlocks after 15 minutes', async () => {
    const { user, password } = await createUser(ctx.deps);
    const a = new Agent(ctx.app);
    for (let i = 0; i < 4; i++) {
      expect(
        (await a.req('POST', '/api/auth/login', { email: user.email, password: 'bad' })).statusCode,
      ).toBe(401);
    }
    const fifth = await a.req('POST', '/api/auth/login', { email: user.email, password: 'bad' });
    expect(fifth.statusCode).toBe(423);
    // Even the correct password is refused while locked.
    expect((await a.req('POST', '/api/auth/login', { email: user.email, password })).statusCode).toBe(423);
    ctx.deps.clock.advanceMinutes(16);
    expect((await a.req('POST', '/api/auth/login', { email: user.email, password })).statusCode).toBe(200);
  });

  it('respects a changed maxFailedLogins setting', async () => {
    await ctx.deps.db.setting.create({ data: { key: 'maxFailedLogins', value: '3' } });
    const { user } = await createUser(ctx.deps);
    const a = new Agent(ctx.app);
    await a.req('POST', '/api/auth/login', { email: user.email, password: 'bad' });
    await a.req('POST', '/api/auth/login', { email: user.email, password: 'bad' });
    expect((await a.req('POST', '/api/auth/login', { email: user.email, password: 'bad' })).statusCode).toBe(
      423,
    );
  });

  it('rejects a disabled user', async () => {
    const { user, password } = await createUser(ctx.deps, { active: false });
    const r = await new Agent(ctx.app).req('POST', '/api/auth/login', { email: user.email, password });
    expect(r.statusCode).toBe(401);
  });

  it('rejects a replayed TOTP code', async () => {
    const { user, password, secret } = await createUser(ctx.deps);
    const code = totpNow(secret!, ctx.deps.clock);
    const a = await new Agent(ctx.app).signIn(user.email, password, secret!, ctx.deps.clock);
    await a.req('POST', '/api/auth/logout');

    const b = new Agent(ctx.app);
    await b.req('POST', '/api/auth/login', { email: user.email, password });
    await b.refreshCsrf();
    const r = await b.req('POST', '/api/auth/2fa/verify', { code });
    expect(r.statusCode).toBe(400);
  });

  it('accepts a recovery code once', async () => {
    const { user, password } = await createUser(ctx.deps, { totp: false });
    const a = new Agent(ctx.app);
    await a.req('POST', '/api/auth/login', { email: user.email, password });
    await a.refreshCsrf();
    const setup = await a.req('POST', '/api/auth/2fa/setup');
    const secret = setup.json().secret as string;
    const en = await a.req('POST', '/api/auth/2fa/enable', { code: totpNow(secret, ctx.deps.clock) });
    const codes = en.json().recoveryCodes as string[];
    expect(codes).toHaveLength(10);
    await a.refreshCsrf();
    await a.req('POST', '/api/auth/logout');

    for (const expected of [200, 400]) {
      const b = new Agent(ctx.app);
      await b.req('POST', '/api/auth/login', { email: user.email, password });
      await b.refreshCsrf();
      expect((await b.req('POST', '/api/auth/2fa/verify', { code: codes[0] })).statusCode).toBe(expected);
    }
  });
});

describe('2FA enrollment', () => {
  it('forces setup when 2FA is mandatory and the user has none', async () => {
    const { user, password } = await createUser(ctx.deps, { totp: false });
    const a = new Agent(ctx.app);
    const r = await a.req('POST', '/api/auth/login', { email: user.email, password });
    expect(r.json().stage).toBe('setup_2fa');
    await a.refreshCsrf();
    expect((await a.req('GET', '/api/users')).statusCode).toBe(401);

    const setup = await a.req('POST', '/api/auth/2fa/setup');
    expect(setup.statusCode).toBe(200);
    expect(setup.json().qrDataUrl).toMatch(/^data:image\/png;base64,/);

    const bad = await a.req('POST', '/api/auth/2fa/enable', { code: '000000' });
    expect(bad.statusCode).toBe(400);
    const ok = await a.req('POST', '/api/auth/2fa/enable', {
      code: totpNow(setup.json().secret, ctx.deps.clock),
    });
    expect(ok.statusCode).toBe(200);
    await a.refreshCsrf();
    expect((await a.req('GET', '/api/users')).statusCode).toBe(200);

    const stored = await ctx.deps.db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.totpSecretEnc).not.toContain(setup.json().secret);
  });

  it('skips 2FA when the school turned it off', async () => {
    await ctx.deps.db.setting.create({ data: { key: 'require2fa', value: 'false' } });
    const { user, password } = await createUser(ctx.deps, { totp: false });
    const r = await new Agent(ctx.app).req('POST', '/api/auth/login', { email: user.email, password });
    expect(r.json().stage).toBe('full');
  });
});

describe('session', () => {
  it('logs out after the configured idle time', async () => {
    const { agent } = await signedIn(ctx);
    ctx.deps.clock.advanceMinutes(29);
    expect((await agent.req('GET', '/api/auth/me')).statusCode).toBe(200);
    ctx.deps.clock.advanceMinutes(31);
    const r = await agent.req('GET', '/api/auth/me');
    expect(r.statusCode).toBe(401);
    expect(r.json().error.code).toBe('idle_timeout');
  });

  it('rejects state-changing requests without the CSRF token', async () => {
    const { agent } = await signedIn(ctx);
    const r = await agent.req(
      'POST',
      '/api/users',
      { name: 'x', email: 'x@school.test', role: 'קופאית' },
      { 'x-csrf-token': 'wrong' },
    );
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe('csrf');
  });

  it('rejects text/plain and form bodies (cross-site form CSRF)', async () => {
    const r = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: 'email=a',
      headers: { 'content-type': 'text/plain' },
    });
    expect(r.statusCode).toBe(415);
    const f = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: 'email=a',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(f.statusCode).toBe(415);
  });

  it('revokes the session on logout', async () => {
    const { agent } = await signedIn(ctx);
    const saved = new Map(agent.cookies);
    await agent.req('POST', '/api/auth/logout');
    agent.cookies = saved;
    expect((await agent.req('GET', '/api/auth/me')).statusCode).toBe(401);
  });

  it('rate-limits login attempts', async () => {
    const a = new Agent(ctx.app);
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) {
      codes.push(
        (await a.req('POST', '/api/auth/login', { email: `n${i}@school.test`, password: 'x' })).statusCode,
      );
    }
    expect(codes.slice(0, 10).every((c) => c === 401)).toBe(true);
    expect(codes[11]).toBe(429);
  });

  it('records login events', async () => {
    await signedIn(ctx);
    const events = await ctx.deps.db.loginEvent.findMany();
    expect(events.map((e) => e.event)).toEqual(expect.arrayContaining(['password_ok', 'success']));
  });
});
