import type { Db } from '../lib/db';
import { verifyAuditChain } from '../modules/audit/service';

export interface IntegrityReport {
  ok: boolean;
  checks: { name: string; ok: boolean; detail: string }[];
  counts: Record<string, number>;
}

/**
 * Checks a database (live, or a restored backup): SQLite structure, foreign keys, the audit hash
 * chain, gap-free document numbering, and that every payment is fully allocated.
 */
export async function checkIntegrity(db: Db): Promise<IntegrityReport> {
  const checks: IntegrityReport['checks'] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  const ic = await db.$queryRawUnsafe<{ integrity_check: string }[]>('PRAGMA integrity_check');
  add('sqlite integrity_check', ic[0]?.integrity_check === 'ok', ic.map((r) => r.integrity_check).join('; '));
  const fk = await db.$queryRawUnsafe<unknown[]>('PRAGMA foreign_key_check');
  add('foreign keys', fk.length === 0, `${fk.length} violations`);

  const broken = await verifyAuditChain(db);
  add('audit hash chain', broken === null, broken === null ? 'intact' : `broken at seq ${broken}`);

  const seqs = await db.documentSequence.findMany();
  for (const s of seqs) {
    const rows = await db.receipt.findMany({ where: { docType: s.docType }, select: { number: true } });
    const nums = rows.map((r) => r.number).sort((a, b) => a - b);
    const gapFree = nums.every((n, i) => i === 0 || n === nums[i - 1]! + 1);
    const next = !nums.length || s.next === nums[nums.length - 1]! + 1;
    add(`numbering ${s.docType}`, gapFree && next, `${nums.length} documents, next ${s.next}`);
  }

  // Every money movement has exactly one document (receipt, credit note or refund).
  const undocumented = await db.payment.count({ where: { receipt: null } });
  add('every payment has a document', undocumented === 0, `${undocumented} without a document`);

  const unbalanced = await db.$queryRawUnsafe<{ id: string }[]>(
    `SELECT p.id FROM "Payment" p LEFT JOIN "PaymentAllocation" a ON a."paymentId" = p.id
     GROUP BY p.id HAVING COALESCE(SUM(a."amountAgorot"), 0) <> MAX(p."amountAgorot")`,
  );
  add('payments fully allocated', unbalanced.length === 0, `${unbalanced.length} payments differ`);

  const migrations = await db.$queryRawUnsafe<{ n: bigint | number }[]>(
    `SELECT COUNT(*) AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`,
  );
  const counts: Record<string, number> = {
    migrations: Number(migrations[0]?.n ?? 0),
    families: await db.family.count(),
    students: await db.student.count(),
    charges: await db.charge.count(),
    payments: await db.payment.count(),
    receipts: await db.receipt.count(),
    auditRows: await db.auditLog.count(),
  };
  return { ok: checks.every((c) => c.ok), checks, counts };
}

/** Consistent online copy of a SQLite database (readers and the writer keep working). */
export async function snapshotTo(db: Db, path: string) {
  if (/['\0]/.test(path)) throw new Error('unsafe path');
  await db.$executeRawUnsafe(`VACUUM INTO '${path}'`);
}
