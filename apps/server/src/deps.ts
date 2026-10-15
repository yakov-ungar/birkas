import type { Config } from './config';
import type { Clock } from './lib/clock';
import { Encryptor } from './lib/crypto';
import type { Db } from './lib/db';
import { createMailer, type Mailer } from './lib/mailer';
import { createPaymentProvider } from './providers/payment';
import type { PaymentProvider } from './providers/payment/types';
import { createTextChannels, type TextChannels } from './providers/messaging';

export interface Deps {
  config: Config;
  db: Db;
  clock: Clock;
  mailer: Mailer;
  enc: Encryptor;
  payments: PaymentProvider;
  texts: TextChannels;
  /** Outgoing HTTP (voice calls). Tests replace it; nothing else calls outside. */
  http: typeof fetch;
}

export function createDeps<C extends Clock>(
  config: Config,
  db: Db,
  clock: C,
  overrides: Partial<Omit<Deps, 'clock'>> = {},
): Deps & { clock: C } {
  const http = overrides.http ?? fetch;
  const enc = overrides.enc ?? new Encryptor(config.APP_ENCRYPTION_KEY);
  return {
    config,
    db,
    mailer: createMailer(db, config),
    enc,
    payments: createPaymentProvider(config),
    texts: createTextChannels(db, enc, http),
    http,
    ...overrides,
    clock,
  };
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: Deps;
  }
}
