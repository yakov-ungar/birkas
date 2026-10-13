import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { TEST_ONLY } from '../../plugins/access';
import { TestClock } from '../../lib/clock';
import { badRequest, parse } from '../../lib/errors';

/** Registered only when ENABLE_TEST_ROUTES=true outside production (see buildApp). */
export async function testRoutes(app: FastifyInstance) {
  const { db, clock } = app.deps;

  app.get('/api/test/outbox', { config: { access: TEST_ONLY } }, async (req) => {
    const { to } = parse(z.object({ to: z.string().optional() }), req.query);
    return {
      mails: await db.outbox.findMany({ where: to ? { to } : {}, orderBy: { createdAt: 'desc' }, take: 20 }),
    };
  });

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
