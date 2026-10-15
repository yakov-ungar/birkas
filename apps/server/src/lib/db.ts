import { AsyncLocalStorage } from 'node:async_hooks';
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
  const base = new PrismaClient({ datasourceUrl: url });
  await base.$connect();
  if (!url.startsWith('file:')) return base;
  // WAL for concurrent readers; busy_timeout so writers wait instead of failing.
  await base.$queryRawUnsafe('PRAGMA journal_mode = WAL');
  await base.$queryRawUnsafe('PRAGMA busy_timeout = 5000');
  await base.$queryRawUnsafe('PRAGMA foreign_keys = ON');
  await base.$queryRawUnsafe('PRAGMA synchronous = NORMAL');
  return serializeWrites(base);
}

const WRITES = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
]);

/**
 * SQLite allows one writer, and a transaction that read before another writer committed cannot
 * upgrade to a write (SQLITE_BUSY_SNAPSHOT). The server is a single process, so interactive
 * transactions and writes made outside a transaction share one in-process queue. Without it, a
 * plain write that waits on SQLite's lock can hold up the engine while a transaction is open, and
 * on a small machine (two cores) both stall until Prisma times out.
 * Code inside a transaction must use `tx`, never `db`. Not needed (and not applied) on PostgreSQL.
 */
function serializeWrites(base: PrismaClient): Db {
  let tail: Promise<unknown> = Promise.resolve();
  const inTx = new AsyncLocalStorage<true>();
  const enqueue = <T>(work: () => Promise<T>): Promise<T> => {
    const run = tail.then(work);
    tail = run.catch(() => undefined);
    return run;
  };
  const db = base.$extends({
    query: {
      $allModels: {
        $allOperations({ operation, args, query }) {
          // Inside a queued transaction the queue is already ours.
          if (!WRITES.has(operation) || inTx.getStore()) return query(args);
          return enqueue(() => query(args));
        },
      },
    },
  }) as unknown as PrismaClient;
  const original = db.$transaction.bind(db) as (...args: unknown[]) => Promise<unknown>;
  (db as unknown as { $transaction: unknown }).$transaction = (arg: unknown, opts?: unknown) => {
    // A batch (array) runs as one statement group in the engine; queue it like a write too.
    if (typeof arg !== 'function') return enqueue(() => original(arg, opts));
    const fn = arg as (tx: unknown) => Promise<unknown>;
    return enqueue(() => original((tx: unknown) => inTx.run(true, () => fn(tx)), opts));
  };
  return db;
}
