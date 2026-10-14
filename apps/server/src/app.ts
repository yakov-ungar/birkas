import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import '@tuition/shared';
import type { Deps } from './deps';
import { errorHandler, notFound } from './lib/errors';
import { loggerOptions } from './lib/logger';
import { PUBLIC, type Access } from './plugins/access';
import { registerAuth } from './plugins/auth';
import { authRoutes } from './modules/auth/routes';
import { userRoutes } from './modules/users/routes';
import { auditRoutes } from './modules/audit/routes';
import { settingsRoutes } from './modules/settings/routes';
import { testRoutes } from './modules/testing/routes';
import { familyRoutes } from './modules/families/routes';
import { statementRoutes } from './modules/families/statement';
import { importRoutes } from './modules/families/import';
import { chargeRoutes } from './modules/charges/routes';
import { paymentRoutes } from './modules/payments/routes';
import { receiptRoutes } from './modules/receipts/routes';
import { searchRoutes } from './modules/search/routes';
import { cardRoutes } from './modules/cards/routes';
import { planRoutes } from './modules/plans/routes';
import { dashboardRoutes } from './modules/dashboard/routes';
import { startScheduler } from './modules/scheduler';
import { checkRoutes } from './modules/checks/routes';
import { cashRoutes } from './modules/cash/routes';
import { bankRoutes } from './modules/bank/routes';
import { messageRoutes } from './modules/messages/routes';
import { bodyContainsPan } from './lib/redact';
import { AppError } from './lib/errors';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

export interface RouteInfo {
  method: string;
  url: string;
  access: Access;
}

export interface BuildOptions {
  /** Pass false in tests that inspect logs themselves. */
  logger?: boolean;
  logStream?: NodeJS.WritableStream;
}

export async function buildApp(deps: Deps, opts: BuildOptions = {}): Promise<FastifyInstance> {
  const { config } = deps;
  if (config.NODE_ENV === 'production' && config.ENABLE_TEST_ROUTES) {
    throw new Error('Refusing to start: test routes enabled in production');
  }

  const logger = opts.logger === false ? false : loggerOptions(config.LOG_LEVEL);
  const app = Fastify({
    logger: logger && opts.logStream ? { ...(logger as object), stream: opts.logStream } : logger,
    trustProxy: config.TRUST_PROXY,
    exposeHeadRoutes: false,
    bodyLimit: 1024 * 1024,
    disableRequestLogging: false,
  });

  app.decorate('deps', deps);

  // Only JSON bodies. Dropping text/plain means a cross-site HTML form cannot reach any
  // endpoint (forms can only send urlencoded, multipart or text/plain): CSRF defense for public routes.
  app.removeContentTypeParser('text/plain');

  const routes: RouteInfo[] = [];
  app.decorate('routeList', routes);
  app.addHook('onRoute', (r) => {
    if (!r.url.startsWith('/api/')) return;
    if (!r.config?.access) throw new Error(`Route ${String(r.method)} ${r.url} has no access declaration`);
    for (const m of [r.method].flat()) routes.push({ method: m, url: r.url, access: r.config.access });
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameSrc: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    hsts: config.COOKIE_SECURE ? { maxAge: 31536000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'no-referrer' },
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  app.setErrorHandler(errorHandler);
  registerAuth(app);

  // Defense in depth: no request may carry something that looks like a full card number.
  app.addHook('preValidation', async (req) => {
    if (!req.url.startsWith('/api/') || req.body === undefined || req.body === null) return;
    if (bodyContainsPan(req.body)) {
      throw new AppError(
        400,
        'card_number_rejected',
        'אין לשלוח מספר כרטיס אשראי למערכת. יש להזין כרטיס רק בשדות המאובטחים של חברת הסליקה',
      );
    }
  });

  app.addHook('onSend', async (req, reply) => {
    if (req.url.startsWith('/api/')) reply.header('cache-control', 'no-store');
  });

  app.get('/health', { config: { access: PUBLIC } }, async (_req, reply) => {
    try {
      await deps.db.$queryRawUnsafe('SELECT 1');
      return { status: 'ok', time: deps.clock.now().toISOString() };
    } catch {
      return reply.status(503).send({ status: 'error' });
    }
  });

  await app.register(authRoutes);
  await app.register(userRoutes);
  await app.register(auditRoutes);
  await app.register(settingsRoutes);
  await app.register(familyRoutes);
  await app.register(statementRoutes);
  await app.register(importRoutes);
  await app.register(chargeRoutes);
  await app.register(paymentRoutes);
  await app.register(receiptRoutes);
  await app.register(searchRoutes);
  await app.register(cardRoutes);
  await app.register(planRoutes);
  await app.register(dashboardRoutes);
  await app.register(checkRoutes);
  await app.register(cashRoutes);
  await app.register(bankRoutes);
  await app.register(messageRoutes);
  if (config.ENABLE_TEST_ROUTES) await app.register(testRoutes);

  if (config.PAYMENT_PROVIDER === 'mock') {
    // The mock acquirer's hosted fields. A real provider serves these from its own domain.
    const here = dirname(fileURLToPath(import.meta.url));
    const mockDir = [join(here, '../assets/mock-provider'), join(here, '../../assets/mock-provider')].find(
      (d) => existsSync(join(d, 'fields.html')),
    );
    if (mockDir) {
      await app.register(async (scope) => {
        scope.addHook('onSend', async (_req, reply) => {
          reply.header(
            'content-security-policy',
            "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'self'; form-action 'none'",
          );
          reply.header('x-frame-options', 'SAMEORIGIN');
        });
        await scope.register(fastifyStatic, {
          root: mockDir,
          prefix: '/mock-provider/',
          decorateReply: false,
        });
      });
    }
  }

  const webDist = config.WEB_DIST ? resolve(config.WEB_DIST) : null;
  if (webDist && existsSync(join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: webDist,
      wildcard: false,
      index: false,
      setHeaders: (res, path) => {
        // Vite emits content-hashed files under /assets.
        if (/[/\\]assets[/\\]/.test(path))
          res.setHeader('cache-control', 'public, max-age=31536000, immutable');
      },
    });
  }

  if (config.SCHEDULER_ENABLED && config.NODE_ENV !== 'test') {
    const stop = startScheduler(deps, app.log);
    app.addHook('onClose', async () => stop());
  }

  app.setNotFoundHandler((req, reply) => {
    if (!req.url.startsWith('/api/') && (req.method === 'GET' || req.method === 'HEAD') && webDist) {
      return reply.header('cache-control', 'no-cache').sendFile('index.html');
    }
    throw notFound('הכתובת לא נמצאה');
  });

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    routeList: RouteInfo[];
  }
}
