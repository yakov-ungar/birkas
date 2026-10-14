import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeApp, signedIn, type TestCtx } from './helpers';
import { SYSTEM_ACTOR, recordAudit, verifyAuditChain } from '../src/modules/audit/service';

let ctx: TestCtx;
beforeEach(async () => {
  ctx = await makeApp();
});
afterEach(() => ctx.close());

const add = (n: number) =>
  ctx.deps.db.$transaction(async (tx) => {
    for (let i = 0; i < n; i++) {
      await recordAudit(tx, SYSTEM_ACTOR, new Date(), {
        action: 't',
        summary: `שורה ${i}`,
        entity: 'T',
        after: { password: 'x', i },
      });
    }
  });

describe('audit log', () => {
  it('cannot be updated or deleted at the database level', async () => {
    await add(1);
    // Prisma reports trigger aborts as a constraint error; raw SQL keeps the trigger's message.
    await expect(ctx.deps.db.auditLog.updateMany({ data: { summary: 'changed' } })).rejects.toThrow();
    await expect(ctx.deps.db.auditLog.deleteMany()).rejects.toThrow();
    await expect(ctx.deps.db.$executeRawUnsafe(`UPDATE AuditLog SET summary = 'x'`)).rejects.toThrow(
      /append-only/,
    );
    await expect(ctx.deps.db.$executeRawUnsafe('DELETE FROM AuditLog')).rejects.toThrow(/append-only/);
    expect((await ctx.deps.db.auditLog.findFirstOrThrow()).summary).toBe('שורה 0');

    await ctx.deps.db.loginEvent.create({ data: { at: new Date(), event: 'fail' } });
    await expect(ctx.deps.db.$executeRawUnsafe('DELETE FROM LoginEvent')).rejects.toThrow(/append-only/);
    expect(await ctx.deps.db.loginEvent.count()).toBe(1);
  });

  it('keeps an intact hash chain and strips secrets from snapshots', async () => {
    await add(5);
    expect(await verifyAuditChain(ctx.deps.db)).toBeNull();
    const rows = await ctx.deps.db.auditLog.findMany({ orderBy: { seq: 'asc' } });
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3, 4, 5]);
    expect(rows[0]!.after).toBe('{"i":0}');
  });

  it('detects a tampered row (simulated by dropping the trigger)', async () => {
    ctx.skipIntegrity = true;
    await add(3);
    await ctx.deps.db.$executeRawUnsafe('DROP TRIGGER AuditLog_no_update');
    await ctx.deps.db.$executeRawUnsafe(`UPDATE AuditLog SET summary = 'זויף' WHERE seq = 2`);
    expect(await verifyAuditChain(ctx.deps.db)).toBe(2);
  });

  it('lists, filters and exports as Excel-friendly CSV', async () => {
    const { agent } = await signedIn(ctx);
    await add(3);
    const list = await agent.req('GET', '/api/audit?q=' + encodeURIComponent('שורה 1'));
    expect(list.json().rows).toHaveLength(1);
    const csv = await agent.req('GET', '/api/audit/export');
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body.startsWith('﻿')).toBe(true);
    expect(csv.body).toContain('שורה 2');
  });
});
