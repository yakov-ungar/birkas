import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { loadConfig } from '../src/config';

const base = { DATABASE_URL: 'file:x.db', APP_ENCRYPTION_KEY: randomBytes(32).toString('base64') };

describe('config', () => {
  it('refuses test routes in production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', ENABLE_TEST_ROUTES: 'true' })).toThrow(
      /production/,
    );
  });

  it('requires a 32-byte encryption key', () => {
    expect(() => loadConfig({ ...base, APP_ENCRYPTION_KEY: 'short' })).toThrow(/32 bytes/);
  });

  it('defaults to secure cookies in production only', () => {
    expect(
      loadConfig({ ...base, NODE_ENV: 'production', APP_BASE_URL: 'https://school.example' }).COOKIE_SECURE,
    ).toBe(true);
    expect(loadConfig({ ...base, NODE_ENV: 'development' }).COOKIE_SECURE).toBe(false);
  });
});
