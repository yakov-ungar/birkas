import type { Config } from './config';
import type { Clock } from './lib/clock';
import { Encryptor } from './lib/crypto';
import type { Db } from './lib/db';
import { createMailer, type Mailer } from './lib/mailer';
import { createPaymentProvider } from './providers/payment';
import type { PaymentProvider } from './providers/payment/types';

export interface Deps {
  config: Config;
  db: Db;
  clock: Clock;
  mailer: Mailer;
  enc: Encryptor;
  payments: PaymentProvider;
}

export function createDeps<C extends Clock>(
  config: Config,
  db: Db,
  clock: C,
  overrides: Partial<Omit<Deps, 'clock'>> = {},
): Deps & { clock: C } {
  return {
    config,
    db,
    mailer: createMailer(db, config),
    enc: new Encryptor(config.APP_ENCRYPTION_KEY),
    payments: createPaymentProvider(config),
    ...overrides,
    clock,
  };
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: Deps;
  }
}
