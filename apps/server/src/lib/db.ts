import { existsSync, mkdirSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

export type Db = PrismaClient;
export type Tx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'>;

/** Prisma resolves relative SQLite paths against the prisma/ folder (src/lib or dist/ both work). */
const here = dirname(fileURLToPath(import.meta.url));
const PRISMA_DIR =
  [resolve(here, '../../prisma'), resolve(here, '../prisma')].find((d) =>
    existsSync(resolve(d, 'schema.prisma')),
  ) ?? process.cwd();

export async function createDb(url: string): Promise<Db> {
  if (url.startsWith('file:')) {
    const path = url.slice('file:'.length).split('?')[0]!;
    mkdirSync(dirname(isAbsolute(path) ? path : resolve(PRISMA_DIR, path)), { recursive: true });
  }
  const db = new PrismaClient({ datasourceUrl: url });
  await db.$connect();
  if (url.startsWith('file:')) {
    // WAL for concurrent readers; busy_timeout so writers wait instead of failing.
    await db.$queryRawUnsafe('PRAGMA journal_mode = WAL');
    await db.$queryRawUnsafe('PRAGMA busy_timeout = 5000');
    await db.$queryRawUnsafe('PRAGMA foreign_keys = ON');
    await db.$queryRawUnsafe('PRAGMA synchronous = NORMAL');
  }
  return db;
}
