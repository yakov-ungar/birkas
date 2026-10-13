/**
 * Test-only: starts the built web app + API on a fresh SQLite file with one admin
 * (no 2FA yet, so the e2e run exercises enrollment). Never used in production.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_PERMISSIONS } from '@tuition/shared';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { TestClock } from '../src/lib/clock';
import { Encryptor } from '../src/lib/crypto';
import { createDb } from '../src/lib/db';
import { createMailer } from '../src/lib/mailer';
import { hashPassword } from '../src/lib/passwords';

const here = fileURLToPath(new URL('.', import.meta.url));
const dir = resolve(here, '../test/.tmp-e2e');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const dbFile = join(dir, 'e2e.db');
const port = process.env.E2E_PORT ?? '4173';

const env = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: port,
  DATABASE_URL: `file:${dbFile}`,
  APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  APP_BASE_URL: `http://127.0.0.1:${port}`,
  ENABLE_TEST_ROUTES: 'true',
  WEB_DIST: resolve(here, '../../web/dist'),
  LOG_LEVEL: 'warn',
};
execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
  cwd: resolve(here, '..'),
  env: { ...process.env, ...env },
  stdio: 'pipe',
});

const config = loadConfig(env as NodeJS.ProcessEnv);
const db = await createDb(config.DATABASE_URL);
await db.user.create({
  data: {
    name: 'רחל (מנהלת)',
    email: 'admin@school.test',
    role: 'מנהל מערכת',
    permissions: JSON.stringify(ALL_PERMISSIONS),
    passwordHash: await hashPassword('Admin-Pass-2026'),
  },
});
const app = await buildApp({
  config,
  db,
  clock: new TestClock(),
  mailer: createMailer(db, config),
  enc: new Encryptor(config.APP_ENCRYPTION_KEY),
});
await app.listen({ host: config.HOST, port: config.PORT });
console.log(`e2e server on ${config.APP_BASE_URL}`);
