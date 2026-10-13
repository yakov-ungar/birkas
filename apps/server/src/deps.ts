import type { Config } from './config';
import type { Clock } from './lib/clock';
import type { Encryptor } from './lib/crypto';
import type { Db } from './lib/db';
import type { Mailer } from './lib/mailer';

export interface Deps {
  config: Config;
  db: Db;
  clock: Clock;
  mailer: Mailer;
  enc: Encryptor;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: Deps;
  }
}
