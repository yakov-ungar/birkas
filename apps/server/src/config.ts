import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z.string().min(1),
    /** 32 random bytes, base64. Encrypts TOTP secrets and (later) provider secrets and tokens. */
    APP_ENCRYPTION_KEY: z
      .string()
      .refine((v) => Buffer.from(v, 'base64').length === 32, 'APP_ENCRYPTION_KEY must be 32 bytes (base64)'),
    APP_BASE_URL: z.string().url().default('http://localhost:5173'),
    COOKIE_SECURE: bool.optional(),
    TRUST_PROXY: bool.default('false'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    WEB_DIST: z.string().optional(),
    MAIL_TRANSPORT: z.enum(['outbox', 'smtp']).default('outbox'),
    SMTP_URL: z.string().optional(),
    MAIL_FROM: z.string().default('מערכת גבייה <no-reply@example.invalid>'),
    /** Only the mock exists until a real acquirer is chosen (plan stage 9). */
    PAYMENT_PROVIDER: z.enum(['mock']).default('mock'),
    /** Mock only: probability (0..1) that an otherwise valid charge fails, for tests. */
    MOCK_FAILURE_RATE: z.coerce.number().min(0).max(1).default(0),
    /** Where to email operational alerts (failed nightly run). Defaults to active admins. */
    ALERT_EMAIL: z.string().email().optional(),
    /** Run the in-process scheduler (nightly charges). Off in tests. */
    SCHEDULER_ENABLED: bool.default('true'),
    /** Sign-in attempts per IP per 15 minutes (staff login and 2FA). Raised only for the browser tests. */
    LOGIN_RATE_LIMIT: z.coerce.number().int().min(1).max(1000).default(10),
    /** Test-only time travel and helper routes. Refused in production. */
    ENABLE_TEST_ROUTES: bool.default('false'),
  })
  .superRefine((v, ctx) => {
    if (v.NODE_ENV === 'production' && v.ENABLE_TEST_ROUTES) {
      ctx.addIssue({ code: 'custom', message: 'ENABLE_TEST_ROUTES must not be enabled in production' });
    }
    if (v.MAIL_TRANSPORT === 'smtp' && !v.SMTP_URL) {
      ctx.addIssue({ code: 'custom', message: 'SMTP_URL is required when MAIL_TRANSPORT=smtp' });
    }
  });

export type Config = Omit<z.infer<typeof envSchema>, 'COOKIE_SECURE'> & { COOKIE_SECURE: boolean };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.') || 'env'}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${msg}`);
  }
  const c = parsed.data;
  return { ...c, COOKIE_SECURE: c.COOKIE_SECURE ?? c.NODE_ENV === 'production' };
}
