import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { existsSync, readFileSync } from 'node:fs';
import { TEST_ONLY } from '../../plugins/access';
import { TestClock } from '../../lib/clock';
import { badRequest, parse } from '../../lib/errors';
import { israelDate } from '../../lib/clock';
import { monthlyDate } from '../../domain/schedule';
import { schedulerTick } from '../scheduler';
import { cookieName } from '../auth/session';
import { sha256 } from '../../lib/crypto';

/** Registered only when ENABLE_TEST_ROUTES=true outside production (see buildApp). */
export async function testRoutes(app: FastifyInstance) {
  const { db, clock } = app.deps;

  app.get('/api/test/outbox', { config: { access: TEST_ONLY } }, async (req) => {
    const { to } = parse(z.object({ to: z.string().optional() }), req.query);
    return {
      mails: await db.outbox.findMany({ where: to ? { to } : {}, orderBy: { createdAt: 'desc' }, take: 20 }),
    };
  });

  /** Texts the mock SMS gateway sent (in memory). Used to read portal sign-in codes in tests. */
  app.get('/api/test/texts', { config: { access: TEST_ONLY } }, async (req) => {
    const { to } = parse(z.object({ to: z.string().optional() }), req.query);
    const sms = app.deps.texts.sms as { sent?: { to: string; body: string }[] };
    return { texts: (sms.sent ?? []).filter((t) => !to || t.to === to) };
  });

  /** Scans every table for a string (used to prove card numbers never reach the database). */
  app.get('/api/test/scan', { config: { access: TEST_ONLY } }, async (req) => {
    const { needle } = parse(z.object({ needle: z.string().min(4) }), req.query);
    const tables = await db.$queryRawUnsafe<{ name: string }[]>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%'`,
    );
    const hits: string[] = [];
    for (const t of tables) {
      const rows = await db.$queryRawUnsafe<unknown[]>(`SELECT * FROM "${t.name.replace(/"/g, '')}"`);
      if (JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? String(v) : v)).includes(needle))
        hits.push(t.name);
    }
    // The e2e server also writes its logs to a file; card numbers must not be there either.
    const logFile = process.env.E2E_LOG_FILE;
    if (logFile && existsSync(logFile) && readFileSync(logFile, 'utf8').includes(needle))
      hits.push('server.log');
    return { hits, logsScanned: !!logFile };
  });

  /** Demo's "קדם חודש": moves the test clock to the same day next month (day capped at 28, like the demo). */
  app.post('/api/test/clock/advance-month', { config: { access: TEST_ONLY } }, async (req) => {
    if (!(clock instanceof TestClock)) throw badRequest('test clock is not active');
    const today = israelDate(clock.now());
    const day = Math.min(Number(today.slice(8, 10)), 28);
    const target = monthlyDate(`${today.slice(0, 8)}${String(day).padStart(2, '0')}`, 1);
    clock.advance(Date.parse(target) - Date.parse(today));
    // Keep the caller signed in across the jump (otherwise the idle timeout logs them out).
    const token = req.cookies[cookieName(app.deps.config.COOKIE_SECURE)];
    if (token) {
      const now = clock.now();
      await db.session.updateMany({
        where: { tokenHash: sha256(token), revokedAt: null },
        data: { lastSeenAt: now, expiresAt: new Date(now.getTime() + 12 * 3600_000) },
      });
    }
    return { today: israelDate(clock.now()) };
  });

  app.post('/api/test/clock/reset', { config: { access: TEST_ONLY } }, async () => {
    if (!(clock instanceof TestClock)) throw badRequest('test clock is not active');
    clock.reset();
    return { now: clock.now().toISOString() };
  });

  app.post('/api/test/scheduler/tick', { config: { access: TEST_ONLY } }, async () =>
    schedulerTick(app.deps),
  );

  app.post('/api/test/clock/advance', { config: { access: TEST_ONLY } }, async (req) => {
    const { minutes } = parse(
      z.object({
        minutes: z
          .number()
          .int()
          .min(1)
          .max(60 * 24 * 400),
      }),
      req.body,
    );
    if (!(clock instanceof TestClock)) throw badRequest('test clock is not active');
    clock.advanceMinutes(minutes);
    return { now: clock.now().toISOString() };
  });
}
