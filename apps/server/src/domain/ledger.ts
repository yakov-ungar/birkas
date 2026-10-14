export interface ChargeLite {
  id: string;
  studentId: string;
  amountAgorot: number;
  date: string;
  type: string;
  yearName: string;
  description: string;
  reversalOfId: string | null;
  createdAt: Date;
}

export interface CreditLite {
  /** Allocation id */
  id: string;
  paymentId: string;
  studentId: string;
  amountAgorot: number;
  date: string;
  description: string;
  createdAt: Date;
  receiptNumber?: number;
}

export const DAY_MS = 86_400_000;
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);

export const sumBy = <T>(xs: readonly T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);

export function balanceOf(charges: readonly ChargeLite[], credits: readonly CreditLite[]): number {
  return sumBy(charges, (c) => c.amountAgorot) - sumBy(credits, (c) => c.amountAgorot);
}

/** "Charged net" as the demo shows it: all charges including discounts and reversals. */
export const netCharged = (charges: readonly ChargeLite[]) => sumBy(charges, (c) => c.amountAgorot);

/** Ids of charges that were cancelled, and of the reversal rows themselves. */
export function reversalSets(charges: readonly ChargeLite[]) {
  const reversed = new Set<string>();
  const reversals = new Set<string>();
  for (const c of charges) {
    if (c.reversalOfId) {
      reversed.add(c.reversalOfId);
      reversals.add(c.id);
    }
  }
  return { reversed, reversals };
}

export type AgingBuckets = [number, number, number, number];
export const AGING_LABELS = ['שוטף', '31-60 יום', '61-90 יום', '90+ יום'] as const;

/**
 * The demo's `aging`: credits (payments and negative charges) settle positive charges oldest first;
 * whatever remains of each charge is bucketed by its age. Cancelled charges and their reversal
 * rows offset each other and are left out.
 */
export function agingOf(
  charges: readonly ChargeLite[],
  credits: readonly CreditLite[],
  today: string,
): AgingBuckets {
  const { reversed, reversals } = reversalSets(charges);
  const live = charges.filter((c) => !reversed.has(c.id) && !reversals.has(c.id));
  const debits = live
    .filter((c) => c.amountAgorot > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || +a.createdAt - +b.createdAt);
  let credit =
    sumBy(credits, (c) => c.amountAgorot) +
    sumBy(
      live.filter((c) => c.amountAgorot < 0),
      (c) => -c.amountAgorot,
    );
  const b: AgingBuckets = [0, 0, 0, 0];
  for (const c of debits) {
    const used = Math.min(c.amountAgorot, Math.max(credit, 0));
    credit -= used;
    const rest = c.amountAgorot - used;
    if (rest > 0) {
      const age = Math.max(0, daysBetween(c.date, today));
      b[age <= 30 ? 0 : age <= 60 ? 1 : age <= 90 ? 2 : 3] += rest;
    }
  }
  // Net negative credit (refunds beyond payments) is debt without a charge date: count it as current.
  if (credit < 0) b[0] -= credit;
  return b;
}

export const addAging = (a: AgingBuckets, b: AgingBuckets): AgingBuckets => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
  a[3] + b[3],
];

/** Label of the oldest bucket with money in it, as in the demo ("-" when nothing is owed). */
export function agingLabel(b: AgingBuckets): string {
  for (let i = 3; i >= 0; i--) if (b[i]! > 0) return AGING_LABELS[i]!;
  return '-';
}

export interface LedgerLine {
  date: string;
  studentId: string;
  description: string;
  debitAgorot: number;
  creditAgorot: number;
  balanceAgorot: number;
  kind: 'charge' | 'payment';
  refId: string;
  cancelled: boolean;
  receiptNumber?: number;
}

/** Chronological ledger with a running balance; on the same date charges come before payments (demo). */
export function buildLedger(charges: readonly ChargeLite[], credits: readonly CreditLite[]): LedgerLine[] {
  const { reversed } = reversalSets(charges);
  const rows: (Omit<LedgerLine, 'balanceAgorot'> & { o: number; t: number })[] = [
    ...charges.map((c) => ({
      date: c.date,
      studentId: c.studentId,
      description: c.description,
      debitAgorot: c.amountAgorot > 0 ? c.amountAgorot : 0,
      creditAgorot: c.amountAgorot < 0 ? -c.amountAgorot : 0,
      kind: 'charge' as const,
      refId: c.id,
      cancelled: reversed.has(c.id),
      o: 0,
      t: +c.createdAt,
    })),
    ...credits.map((p) => ({
      date: p.date,
      studentId: p.studentId,
      description: p.description,
      debitAgorot: p.amountAgorot < 0 ? -p.amountAgorot : 0,
      creditAgorot: p.amountAgorot > 0 ? p.amountAgorot : 0,
      kind: 'payment' as const,
      refId: p.paymentId,
      cancelled: false,
      receiptNumber: p.receiptNumber,
      o: 1,
      t: +p.createdAt,
    })),
  ];
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.o - b.o || a.t - b.t);
  let bal = 0;
  return rows.map(({ o: _o, t: _t, ...r }) => {
    bal += r.debitAgorot - r.creditAgorot;
    return { ...r, balanceAgorot: bal };
  });
}
