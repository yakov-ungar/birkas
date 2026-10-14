/**
 * Test-only: starts the built web app + API on a fresh SQLite file with one admin
 * (no 2FA yet, so the e2e run exercises enrollment). Never used in production.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_PERMISSIONS } from '@tuition/shared';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { TestClock } from '../src/lib/clock';
import { createDb } from '../src/lib/db';
import { createDeps } from '../src/deps';
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
  LOG_LEVEL: 'info',
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
// Second admin with 2FA already enrolled from a fixed test secret, for specs after stage 1.
const deps0 = createDeps(config, db, new TestClock());
await db.user.create({
  data: {
    name: 'מזכירות',
    email: 'office@school.test',
    role: 'מנהל מערכת',
    permissions: JSON.stringify(ALL_PERMISSIONS),
    passwordHash: await hashPassword('Office-Pass-2026'),
    totpSecretEnc: deps0.enc.encrypt('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'),
    totpEnabledAt: new Date(),
  },
});
const logFile = join(dir, 'server.log');
process.env.E2E_LOG_FILE = logFile;
const app = await buildApp({ ...deps0 }, { logStream: createWriteStream(logFile) });
await app.listen({ host: config.HOST, port: config.PORT });
console.log(`e2e server on ${config.APP_BASE_URL}`);
