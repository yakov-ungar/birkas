import { DOC_TYPES, PAYMENT_METHODS, type DocType, type PaymentMethod } from '@tuition/shared';
import type { Db, Tx } from '../../lib/db';
import {
  agingOf,
  balanceOf,
  netCharged,
  sumBy,
  type AgingBuckets,
  type ChargeLite,
  type CreditLite,
} from '../../domain/ledger';

export interface StudentMoney {
  charges: ChargeLite[];
  credits: CreditLite[];
}

const creditDescription = (
  p: { kind: string; method: string; reference: string },
  r: { docType: string; number: number } | null,
) => {
  const m = PAYMENT_METHODS[p.method as PaymentMethod] ?? p.method;
  const head = p.kind === 'refund' ? `החזר ${m}` : p.kind === 'reversal' ? `ביטול תשלום ${m}` : `תשלום ${m}`;
  const ref = p.reference ? ` · ${p.reference}` : '';
  const doc = r ? ` (${DOC_TYPES[r.docType as DocType] ?? 'מסמך'} ${r.number})` : '';
  return head + ref + doc;
};

/** Loads every charge and payment allocation for the given students (or all students). */
export async function loadMoney(db: Db | Tx, studentIds?: string[]): Promise<Map<string, StudentMoney>> {
  const where = studentIds ? { studentId: { in: studentIds } } : {};
  const [charges, allocs] = await Promise.all([
    db.charge.findMany({ where, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] }),
    db.paymentAllocation.findMany({
      where,
      include: {
        payment: {
          select: {
            id: true,
            date: true,
            kind: true,
            method: true,
            reference: true,
            createdAt: true,
            receipt: { select: { docType: true, number: true } },
          },
        },
      },
    }),
  ]);
  const out = new Map<string, StudentMoney>();
  const get = (id: string) => {
    let m = out.get(id);
    if (!m) out.set(id, (m = { charges: [], credits: [] }));
    return m;
  };
  for (const id of studentIds ?? []) get(id);
  for (const c of charges) get(c.studentId).charges.push(c);
  for (const a of allocs) {
    const r = a.payment.receipt;
    get(a.studentId).credits.push({
      id: a.id,
      paymentId: a.paymentId,
      studentId: a.studentId,
      amountAgorot: a.amountAgorot,
      date: a.payment.date,
      createdAt: a.payment.createdAt,
      description: creditDescription(a.payment, r),
      receiptNumber: r?.number,
    });
  }
  return out;
}

export const EMPTY: StudentMoney = { charges: [], credits: [] };

export function summarize(m: StudentMoney, today: string) {
  return {
    netChargedAgorot: netCharged(m.charges),
    paidAgorot: sumBy(m.credits, (c) => c.amountAgorot),
    balanceAgorot: balanceOf(m.charges, m.credits),
    aging: agingOf(m.charges, m.credits, today) as AgingBuckets,
  };
}

export async function balancesOf(db: Db | Tx, studentIds: string[]): Promise<Map<string, number>> {
  const money = await loadMoney(db, studentIds);
  return new Map(
    studentIds.map((id) => [
      id,
      balanceOf((money.get(id) ?? EMPTY).charges, (money.get(id) ?? EMPTY).credits),
    ]),
  );
}

/** Net tuition charged to the student for a year (reversals included). */
export async function tuitionOf(db: Db | Tx, studentId: string, yearName: string): Promise<number> {
  const r = await db.charge.aggregate({
    where: { studentId, yearName, type: 'tuition' },
    _sum: { amountAgorot: true },
  });
  return r._sum.amountAgorot ?? 0;
}
