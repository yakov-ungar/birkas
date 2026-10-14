import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb } from '../src/lib/db';
import { checkIntegrity, snapshotTo } from '../src/ops/integrity';
import { hebrewDateOf } from '../src/modules/receipts/service';
import { loadConfig } from '../src/config';
import { makeApp, signedIn, type Agent, type TestCtx } from './helpers';
import { mockCard, newFamily, pay } from './finance-helpers';

let ctx: TestCtx;
let a: Agent;
let dir: string;
beforeEach(async () => {
  ctx = await makeApp();
  a = (await signedIn(ctx)).agent;
  dir = mkdtempSync(join(tmpdir(), 'ops-'));
});
afterEach(async () => {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

async function someData() {
  const f = await newFamily(a);
  const p = (
    await pay(a, {
      familyId: f.familyId,
      amountAgorot: 200000,
      details: { method: 'card', newCard: mockCard() },
    })
  ).json();
  await a.req('POST', `/api/receipts/${p.receipt.id}/cancel`, { reason: 'טעות' });
  await pay(a, {
    familyId: f.familyId,
    amountAgorot: 100000,
    details: { method: 'card', newCard: mockCard() },
  });
}

describe('backup snapshot and integrity check', () => {
  it('a live database passes, and its snapshot opens with the same data and passes too', async () => {
    await someData();
    const live = await checkIntegrity(ctx.deps.db);
    expect(live.checks.filter((c) => !c.ok)).toEqual([]);
    expect(live.counts.receipts).toBe(3);

    const file = join(dir, 'snap.db');
    await snapshotTo(ctx.deps.db, file);
    const copy = await createDb(`file:${file}`);
    const r = await checkIntegrity(copy);
    expect(r.ok).toBe(true);
    expect(r.counts).toEqual(live.counts);
    expect(r.counts.migrations).toBeGreaterThanOrEqual(7);
    await copy.$disconnect();
  });

  it('detects a tampered audit row and a removed receipt in a copy', async () => {
    await someData();
    const file = join(dir, 'bad.db');
    await snapshotTo(ctx.deps.db, file);
    const copy = await createDb(`file:${file}`);
    // Only possible by bypassing the append-only triggers, as an attacker with file access would.
    await copy.$executeRawUnsafe('DROP TRIGGER "AuditLog_no_update"');
    await copy.$executeRawUnsafe(`UPDATE "AuditLog" SET summary = 'שונה' WHERE seq = 2`);
    await copy.$executeRawUnsafe('PRAGMA foreign_keys = OFF');
    for (const t of await copy.$queryRawUnsafe<{ name: string }[]>(
      `SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'Receipt'`,
    ))
      await copy.$executeRawUnsafe(`DROP TRIGGER "${t.name}"`);
    // The cancelled first receipt disappears: a hole in the numbering (3001 gone, 3002 stays).
    await copy.$executeRawUnsafe(`DELETE FROM "Receipt" WHERE "docType" = 'receipt' AND number = 3001`);
    const r = await checkIntegrity(copy);
    expect(r.ok).toBe(false);
    const failed = r.checks.filter((c) => !c.ok).map((c) => c.name);
    expect(failed).toEqual(expect.arrayContaining(['audit hash chain', 'every payment has a document']));
    await copy.$disconnect();
  });

  it('refuses a snapshot path that could break out of the SQL string', async () => {
    await expect(snapshotTo(ctx.deps.db, join(dir, "x'; DROP TABLE Family; --.db"))).rejects.toThrow(
      'unsafe path',
    );
  });
});

describe('production configuration', () => {
  const base = {
    NODE_ENV: 'production',
    DATABASE_URL: 'file:/var/lib/tuition/tuition.db',
    APP_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    APP_BASE_URL: 'https://school.example',
    TRUST_PROXY: 'true',
  };
  it('defaults to Secure cookies, a local-only listener and no test routes', () => {
    const c = loadConfig(base as NodeJS.ProcessEnv);
    expect(c).toMatchObject({ COOKIE_SECURE: true, HOST: '127.0.0.1', ENABLE_TEST_ROUTES: false });
  });
  it('refuses insecure cookies and a plain-http address in production', () => {
    expect(() => loadConfig({ ...base, COOKIE_SECURE: 'false' } as NodeJS.ProcessEnv)).toThrow(
      /COOKIE_SECURE/,
    );
    expect(() => loadConfig({ ...base, APP_BASE_URL: 'http://school.example' } as NodeJS.ProcessEnv)).toThrow(
      /https/,
    );
  });
});

describe('Hebrew date on documents (decision D5)', () => {
  it('formats a business date in the Hebrew calendar', () => {
    expect(hebrewDateOf('2026-10-14')).toBe('3 בחשוון 5787');
    expect(hebrewDateOf('2026-09-12')).toBe('1 בתשרי 5787');
  });
});
