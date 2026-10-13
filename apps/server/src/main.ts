import { loadConfig } from './config';
import { buildApp } from './app';
import { systemClock } from './lib/clock';
import { Encryptor } from './lib/crypto';
import { createDb } from './lib/db';
import { createMailer } from './lib/mailer';

const config = loadConfig();
const db = await createDb(config.DATABASE_URL);
const app = await buildApp({
  config,
  db,
  clock: systemClock,
  mailer: createMailer(db, config),
  enc: new Encryptor(config.APP_ENCRYPTION_KEY),
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await db.$disconnect();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: config.HOST, port: config.PORT });
