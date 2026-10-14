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
    serializeTransactions(db);
  }
  return db;
}

/**
 * SQLite allows one writer, and a transaction that read before another writer committed cannot
 * upgrade to a write (SQLITE_BUSY_SNAPSHOT). The server is a single process, so interactive
 * transactions are queued in-process. Code inside a transaction must use `tx`, never `db`.
 * Not needed (and not applied) on PostgreSQL.
 */
function serializeTransactions(db: PrismaClient) {
  const original = db.$transaction.bind(db) as (...args: unknown[]) => Promise<unknown>;
  let tail: Promise<unknown> = Promise.resolve();
  (db as unknown as { $transaction: unknown }).$transaction = (arg: unknown, opts?: unknown) => {
    if (typeof arg !== 'function') return original(arg, opts);
    const run = tail.then(() => original(arg, opts));
    tail = run.catch(() => undefined);
    return run;
  };
}
