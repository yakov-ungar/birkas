import { sha256 } from '../../lib/crypto';
import type { Db, Tx } from '../../lib/db';

export interface Actor {
  type: 'user' | 'parent' | 'system';
  id: string | null;
  name: string;
  ip?: string | null;
}

export const SYSTEM_ACTOR: Actor = { type: 'system', id: null, name: 'מערכת' };

export interface AuditEntry {
  action: string;
  summary: string;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

/** Fields that must never be copied into audit snapshots. */
const SECRET_KEYS = new Set([
  'passwordHash',
  'totpSecretEnc',
  'tokenHash',
  'codeHash',
  'csrfToken',
  'token',
  'password',
]);

export function snapshot(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  return JSON.stringify(v, (k, val) => (SECRET_KEYS.has(k) ? undefined : val));
}

const GENESIS = '0'.repeat(64);

function hashRow(r: {
  seq: number;
  at: Date;
  actorType: string;
  actorId: string | null;
  actorName: string;
  action: string;
  summary: string;
  entity: string;
  entityId: string | null;
  before: string | null;
  after: string | null;
  ip: string | null;
  prevHash: string;
}): string {
  return sha256(
    JSON.stringify([
      r.seq,
      r.at.toISOString(),
      r.actorType,
      r.actorId,
      r.actorName,
      r.action,
      r.summary,
      r.entity,
      r.entityId,
      r.before,
      r.after,
      r.ip,
      r.prevHash,
    ]),
  );
}

/**
 * Appends one audit row inside the caller's transaction, so the change and its audit
 * record commit (or roll back) together. SQLite serializes writers, so seq is gap-free.
 */
export async function recordAudit(tx: Tx, actor: Actor, at: Date, e: AuditEntry): Promise<void> {
  const last = await tx.auditLog.findFirst({ orderBy: { seq: 'desc' }, select: { seq: true, hash: true } });
  const row = {
    seq: (last?.seq ?? 0) + 1,
    at,
    actorType: actor.type,
    actorId: actor.id,
    actorName: actor.name,
    action: e.action,
    summary: e.summary,
    entity: e.entity,
    entityId: e.entityId ?? null,
    before: snapshot(e.before),
    after: snapshot(e.after),
    ip: actor.ip ?? null,
    prevHash: last?.hash ?? GENESIS,
  };
  await tx.auditLog.create({ data: { ...row, hash: hashRow(row) } });
}

/** Recomputes the chain; returns the seq of the first broken row, or null if intact. */
export async function verifyAuditChain(db: Db): Promise<number | null> {
  let prev = GENESIS;
  let expectedSeq = 1;
  const rows = await db.auditLog.findMany({ orderBy: { seq: 'asc' } });
  for (const r of rows) {
    if (r.seq !== expectedSeq || r.prevHash !== prev || hashRow(r) !== r.hash) return r.seq;
    prev = r.hash;
    expectedSeq++;
  }
  return null;
}
