import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Agent, createUser, makeApp, totpNow, type TestCtx } from './helpers';

// Production-like: Secure cookies (the __Host- prefix) and HSTS.
let ctx: TestCtx;
beforeAll(async () => {
  ctx = await makeApp({ COOKIE_SECURE: 'true' });
});
afterAll(() => ctx.close());

describe('headers and cookies with COOKIE_SECURE (stage 8 hardening)', () => {
  it('sends HSTS, CSP, nosniff and no framing, and never says what runs behind', async () => {
    const r = await ctx.app.inject({ url: '/health' });
    expect(r.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
    expect(r.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(r.headers['content-security-policy']).toContain("object-src 'none'");
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['referrer-policy']).toBe('no-referrer');
    expect(r.headers['x-powered-by']).toBeUndefined();
    expect(r.headers['server']).toBeUndefined();
  });

  it('API answers are never cached and errors carry no stack trace', async () => {
    const r = await ctx.app.inject({ url: '/api/auth/me' });
    expect(r.statusCode).toBe(401);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(Object.keys(r.json())).toEqual(['error']);
    expect(r.body).not.toMatch(/at \w+ \(|node_modules|\.ts:\d+/);
    const bad = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{"email":',
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.body).not.toMatch(/at \w+ \(|node_modules|SyntaxError/);
  });

  it('the staff session cookie is __Host-, Secure, HttpOnly, SameSite=Strict', async () => {
    const { user, password, secret } = await createUser(ctx.deps);
    const a = new Agent(ctx.app);
    const r = await a.req('POST', '/api/auth/login', { email: user.email, password });
    const c = r.cookies.find((x) => x.name === '__Host-sid')!;
    expect(c).toMatchObject({ secure: true, httpOnly: true, sameSite: 'Strict', path: '/' });
    expect(c.domain).toBeUndefined();
    await a.refreshCsrf();
    const v = await a.req('POST', '/api/auth/2fa/verify', { code: totpNow(secret!, ctx.deps.clock) });
    expect(v.cookies.find((x) => x.name === '__Host-sid')).toMatchObject({ secure: true, httpOnly: true });
  });

  it('text/plain and form posts are refused (no cross-site form can reach the API)', async () => {
    for (const ct of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']) {
      const r = await ctx.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'content-type': ct },
        payload: 'email=a@b.c&password=x',
      });
      expect(r.statusCode, ct).toBe(415);
    }
  });
});
