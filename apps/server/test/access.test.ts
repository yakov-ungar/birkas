import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS } from '@tuition/shared';
import { Agent, makeApp, signedIn, type TestCtx } from './helpers';
import { permsOf } from '../src/plugins/access';

let ctx: TestCtx;
beforeAll(async () => {
  ctx = await makeApp();
});
afterAll(() => ctx.close());

const fill = (url: string) => url.replace(/:(\w+)/g, 'x-$1');

describe('route access', () => {
  it('every /api route declares an access rule', () => {
    expect(ctx.app.routeList.length).toBeGreaterThan(10);
    for (const r of ctx.app.routeList) expect(r.access, `${r.method} ${r.url}`).toBeDefined();
  });

  it('a route without an access rule makes the app refuse to start', async () => {
    const { buildApp } = await import('../src/app');
    const app = await buildApp(ctx.deps, { logger: false });
    expect(() => app.get('/api/oops', async () => 'x')).toThrow(/no access declaration/);
    await app.close();
  });

  it('every session route returns 401 without a session', async () => {
    const anon = new Agent(ctx.app);
    for (const r of ctx.app.routeList.filter((x) => x.access.type === 'session')) {
      const res = await anon.req(r.method, fill(r.url), r.method === 'GET' ? undefined : {});
      expect(res.statusCode, `${r.method} ${r.url}`).toBe(401);
    }
  });

  it('every parent route returns 401 without a parent session, even with a staff session', async () => {
    const parentRoutes = ctx.app.routeList.filter((x) => x.access.type === 'parent');
    expect(parentRoutes.length).toBeGreaterThan(4);
    const { agent } = await signedIn(ctx);
    for (const a of [new Agent(ctx.app), agent])
      for (const r of parentRoutes) {
        const res = await a.req(r.method, fill(r.url), r.method === 'GET' ? undefined : {});
        expect(res.statusCode, `${r.method} ${r.url}`).toBe(401);
      }
  });

  it('every permission-protected route returns 403 to a user lacking the permissions that unlock it', async () => {
    const protectedRoutes = ctx.app.routeList.filter((x) => permsOf(x.access).length);
    expect(protectedRoutes.length).toBeGreaterThan(30);
    // Group by the exact set of permissions that unlock a route ("any of"); sign in once per set without them.
    const groups = new Map<string, typeof protectedRoutes>();
    for (const r of protectedRoutes) {
      const k = permsOf(r.access).sort().join(',');
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    expect([...groups.keys()]).toEqual(expect.arrayContaining(['pay,rec', 'charges,pay']));
    for (const [k, routes] of groups) {
      const lacking = k.split(',');
      const { agent } = await signedIn(
        ctx,
        ALL_PERMISSIONS.filter((p) => !lacking.includes(p)),
      );
      for (const r of routes) {
        const res = await agent.req(r.method, fill(r.url), r.method === 'GET' ? undefined : {});
        expect(res.statusCode, `${r.method} ${r.url} without ${k}`).toBe(403);
      }
    }
  });

  it('test routes are absent when not enabled', async () => {
    const other = await makeApp({ ENABLE_TEST_ROUTES: 'false' });
    expect(other.app.routeList.some((r) => r.url.startsWith('/api/test'))).toBe(false);
    await other.close();
  });

  it('serves /health and unknown API paths as JSON 404 in Hebrew', async () => {
    expect((await ctx.app.inject({ url: '/health' })).json().status).toBe('ok');
    const r = await ctx.app.inject({ url: '/api/nope' });
    expect(r.statusCode).toBe(404);
    expect(r.json().error.message).toBe('הכתובת לא נמצאה');
  });

  it('sends security headers', async () => {
    const r = await ctx.app.inject({ url: '/health' });
    expect(r.headers['content-security-policy']).toContain("default-src 'self'");
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-frame-options']).toBeDefined();
  });
});
