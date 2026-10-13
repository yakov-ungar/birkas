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
  if (config.ENABLE_TEST_ROUTES) await app.register(testRoutes);

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
