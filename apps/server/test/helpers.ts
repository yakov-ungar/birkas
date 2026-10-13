import { copyFileSync, rmSync } from 'node:fs';
import { inject } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { Writable } from 'node:stream';
import { authenticator } from 'otplib';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { ALL_PERMISSIONS, roleFor, type Permission } from '@tuition/shared';
import { buildApp } from '../src/app';
import { loadConfig, type Config } from '../src/config';
import { TestClock } from '../src/lib/clock';
import { Encryptor } from '../src/lib/crypto';
import { createDb } from '../src/lib/db';
import { createMailer } from '../src/lib/mailer';
import { hashPassword } from '../src/lib/passwords';
import type { Deps } from '../src/deps';

export type TestDeps = Deps & { clock: TestClock };

export interface TestCtx {
  app: FastifyInstance;
  deps: TestDeps;
  logs: string[];
  close(): Promise<void>;
}

export async function makeApp(env: Partial<Record<keyof Config, string>> = {}): Promise<TestCtx> {
  const template = inject('templateDb');
  const file = join(dirname(template), `${randomUUID()}.db`);
  copyFileSync(template, file);
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: `file:${file}`,
    APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    APP_BASE_URL: 'http://localhost:5173',
    LOG_LEVEL: 'info',
    ENABLE_TEST_ROUTES: 'true',
    ...env,
  } as NodeJS.ProcessEnv);
  const db = await createDb(config.DATABASE_URL);
  const clock = new TestClock();
  const deps: TestDeps = {
    config,
    db,
    clock,
    mailer: createMailer(db, config),
    enc: new Encryptor(config.APP_ENCRYPTION_KEY),
  };
  const logs: string[] = [];
  const logStream = new Writable({
    write(chunk, _enc, cb) {
      logs.push(String(chunk));
      cb();
    },
  });
  const app = await buildApp(deps, { logStream });
  await app.ready();
  return {
    app,
    deps,
    logs,
    async close() {
      await app.close();
      await db.$disconnect();
      for (const f of [file, `${file}-wal`, `${file}-shm`]) rmSync(f, { force: true });
    },
  };
}

let seq = 0;

export async function createUser(
  deps: Deps,
  opts: {
    permissions?: Permission[];
    password?: string;
    totp?: boolean;
    name?: string;
    email?: string;
    active?: boolean;
  } = {},
) {
  const permissions = opts.permissions ?? ALL_PERMISSIONS;
  const password = opts.password ?? 'Correct-Horse-9';
  const secret = opts.totp === false ? null : authenticator.generateSecret(20);
  seq++;
  const user = await deps.db.user.create({
    data: {
      name: opts.name ?? `משתמש ${seq}`,
      email: opts.email ?? `user${seq}-${randomUUID().slice(0, 6)}@school.test`,
      role: roleFor(permissions),
      permissions: JSON.stringify(permissions),
      passwordHash: await hashPassword(password),
      active: opts.active ?? true,
      totpSecretEnc: secret ? deps.enc.encrypt(secret) : null,
      totpEnabledAt: secret ? new Date() : null,
    },
  });
  return { user, password, secret };
}

export const totpNow = (secret: string, clock: TestClock, offsetSteps = 0) =>
  authenticator.clone({ epoch: clock.now().getTime() + offsetSteps * 30_000 }).generate(secret);

/** A tiny cookie-keeping client for app.inject(). */
export class Agent {
  cookies = new Map<string, string>();
  csrf = '';
  constructor(private readonly app: FastifyInstance) {}

  async req(
    method: string,
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<LightMyRequestResponse> {
    const res = await this.app.inject({
      method: method as 'GET',
      url,
      payload: body === undefined ? undefined : (body as object),
      headers: {
        ...(this.cookies.size ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
        ...(this.csrf && method !== 'GET' ? { 'x-csrf-token': this.csrf } : {}),
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0',
        ...headers,
      },
    });
    for (const c of res.cookies) {
      if (c.value === '' || (c.expires && c.expires.getTime() < Date.now())) this.cookies.delete(c.name);
      else this.cookies.set(c.name, c.value);
    }
    return res;
  }

  async refreshCsrf() {
    const me = await this.req('GET', '/api/auth/me');
    if (me.statusCode === 200) this.csrf = me.json().csrfToken;
    return me;
  }

  /** Password + TOTP sign-in. */
  async signIn(email: string, password: string, secret: string, clock: TestClock) {
    const r1 = await this.req('POST', '/api/auth/login', { email, password });
    if (r1.statusCode !== 200) throw new Error(`login failed: ${r1.statusCode} ${r1.body}`);
    await this.refreshCsrf();
    const r2 = await this.req('POST', '/api/auth/2fa/verify', { code: totpNow(secret, clock) });
    if (r2.statusCode !== 200) throw new Error(`2fa failed: ${r2.statusCode} ${r2.body}`);
    await this.refreshCsrf();
    return this;
  }
}

/** Creates a user with the given permissions and returns a signed-in agent. */
export async function signedIn(ctx: TestCtx, permissions: Permission[] = ALL_PERMISSIONS) {
  const { user, password, secret } = await createUser(ctx.deps, { permissions });
  const agent = await new Agent(ctx.app).signIn(user.email, password, secret!, ctx.deps.clock);
  return { agent, user };
}
