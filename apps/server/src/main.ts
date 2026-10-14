import { loadConfig } from './config';
import { buildApp } from './app';
import { systemClock } from './lib/clock';
import { createDb } from './lib/db';
import { createDeps } from './deps';

const config = loadConfig();
const db = await createDb(config.DATABASE_URL);
const app = await buildApp(createDeps(config, db, systemClock));

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await db.$disconnect();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: config.HOST, port: config.PORT });
