import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { allocate, allocationProblem } from '../src/domain/allocate';
import { siblingDiscounts } from '../src/domain/siblings';
import {
  agingLabel,
  agingOf,
  balanceOf,
  buildLedger,
  type ChargeLite,
  type CreditLite,
} from '../src/domain/ledger';

const ch = (p: Partial<ChargeLite> & { amountAgorot: number; date: string }): ChargeLite => ({
  id: Math.random().toString(36).slice(2),
  studentId: 's1',
  type: 'other',
  yearName: 'תשפ״ז',
  description: 'x',
  reversalOfId: null,
  createdAt: new Date(p.date),
  ...p,
});
const cr = (amountAgorot: number, date = '2026-01-01'): CreditLite => ({
  id: Math.random().toString(36).slice(2),
  paymentId: 'p',
  studentId: 's1',
  amountAgorot,
  date,
  description: 'תשלום',
  createdAt: new Date(date),
});

describe('allocate (demo rules)', () => {
  it('pays the largest debt first and caps each kid at its debt', () => {
    const parts = allocate(
      [
        { studentId: 'a', balanceAgorot: 100000 },
        { studentId: 'b', balanceAgorot: 300000 },
        { studentId: 'c', balanceAgorot: 0 },
      ],
      350000,
    );
    expect(parts).toEqual([
      { studentId: 'b', amountAgorot: 300000 },
      { studentId: 'a', amountAgorot: 50000 },
    ]);
  });

  it('adds any overpayment to the first part', () => {
    expect(
      allocate(
        [
          { studentId: 'a', balanceAgorot: 1000 },
          { studentId: 'b', balanceAgorot: 500 },
        ],
        2000,
      ),
    ).toEqual([
      { studentId: 'a', amountAgorot: 1500 },
      { studentId: 'b', amountAgorot: 500 },
    ]);
  });

  it('gives everything to the first kid when nobody owes', () => {
    expect(
      allocate(
        [
          { studentId: 'a', balanceAgorot: -100 },
          { studentId: 'b', balanceAgorot: 0 },
        ],
        700,
      ),
    ).toEqual([{ studentId: 'b', amountAgorot: 700 }]);
  });

  it('keeps family order for equal balances', () => {
    const parts = allocate(
      [
        { studentId: 'x', balanceAgorot: 500 },
        { studentId: 'y', balanceAgorot: 500 },
      ],
      600,
    );
    expect(parts.map((p) => p.studentId)).toEqual(['x', 'y']);
  });

  it('property: parts sum to the amount, are positive, unique and from the family', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: -1_000_000, max: 5_000_000 }), { minLength: 1, maxLength: 8 }),
        fc.integer({ min: 1, max: 20_000_000 }),
        (balances, amount) => {
          const kids = balances.map((b, i) => ({ studentId: `k${i}`, balanceAgorot: b }));
          const parts = allocate(kids, amount);
          expect(parts.reduce((s, p) => s + p.amountAgorot, 0)).toBe(amount);
          expect(parts.every((p) => Number.isInteger(p.amountAgorot) && p.amountAgorot > 0)).toBe(true);
          expect(new Set(parts.map((p) => p.studentId)).size).toBe(parts.length);
          expect(allocationProblem(parts, amount, new Set(kids.map((k) => k.studentId)))).toBeNull();
        },
      ),
    );
  });

  it('validates manual allocations', () => {
    const fam = new Set(['a', 'b']);
    expect(allocationProblem([{ studentId: 'a', amountAgorot: 50 }], 100, fam)).toMatch(/שווה/);
    expect(allocationProblem([{ studentId: 'z', amountAgorot: 100 }], 100, fam)).toMatch(/שייך/);
    expect(
      allocationProblem(
        [
          { studentId: 'a', amountAgorot: -1 },
          { studentId: 'b', amountAgorot: 101 },
        ],
        100,
        fam,
      ),
    ).toMatch(/לא תקין/);
    expect(
      allocationProblem(
        [
          { studentId: 'a', amountAgorot: 0 },
          { studentId: 'b', amountAgorot: 100 },
        ],
        100,
        fam,
      ),
    ).toBeNull();
  });
});

describe('sibling discount (demo rules)', () => {
  const pct = [0, 10, 20];
  it('first full, second 10%, third and later 20%, by enrollment order among active kids', () => {
    const m = siblingDiscounts(
      [
        { studentId: 'c', active: true, enrollSeq: 3, tuitionAgorot: 960000 },
        { studentId: 'a', active: true, enrollSeq: 1, tuitionAgorot: 960000 },
        { studentId: 'b', active: true, enrollSeq: 2, tuitionAgorot: 960000 },
        { studentId: 'd', active: true, enrollSeq: 4, tuitionAgorot: 960000 },
      ],
      pct,
    );
    expect(Object.fromEntries(m)).toEqual({ a: 0, b: 96000, c: 192000, d: 192000 });
  });

  it('skips inactive kids when counting', () => {
    const m = siblingDiscounts(
      [
        { studentId: 'a', active: false, enrollSeq: 1, tuitionAgorot: 960000 },
        { studentId: 'b', active: true, enrollSeq: 2, tuitionAgorot: 960000 },
        { studentId: 'c', active: true, enrollSeq: 3, tuitionAgorot: 960000 },
      ],
      pct,
    );
    expect(Object.fromEntries(m)).toEqual({ a: 0, b: 0, c: 96000 });
  });

  it('rounds to whole shekels like the demo', () => {
    const m = siblingDiscounts(
      [
        { studentId: 'a', active: true, enrollSeq: 1, tuitionAgorot: 1 },
        { studentId: 'b', active: true, enrollSeq: 2, tuitionAgorot: 999900 },
      ],
      [0, 15, 15],
    );
    expect(m.get('b')).toBe(150000);
  });
});

describe('aging and ledger', () => {
  it('settles oldest charges first and buckets the rest by age', () => {
    const today = '2026-10-14';
    const charges = [
      ch({ amountAgorot: 100000, date: '2026-06-01' }), // 135 days
      ch({ amountAgorot: 100000, date: '2026-08-01' }), // 74 days
      ch({ amountAgorot: 100000, date: '2026-09-01' }), // 43 days
      ch({ amountAgorot: 100000, date: '2026-10-10' }), // 4 days
      ch({ amountAgorot: -50000, date: '2026-10-01', type: 'disc' }),
    ];
    const b = agingOf(charges, [cr(100000)], today);
    expect(b).toEqual([100000, 100000, 50000, 0]);
    expect(agingLabel(b)).toBe('61-90 יום');
    expect(balanceOf(charges, [cr(100000)])).toBe(250000);
  });

  it('ignores cancelled charges and their reversals', () => {
    const orig = ch({ id: 'o', amountAgorot: 50000, date: '2026-01-01' });
    const rev = ch({ id: 'r', amountAgorot: -50000, date: '2026-10-01', reversalOfId: 'o' });
    expect(agingOf([orig, rev], [], '2026-10-14')).toEqual([0, 0, 0, 0]);
    const lines = buildLedger([orig, rev], []);
    expect(lines.map((l) => [l.cancelled, l.balanceAgorot])).toEqual([
      [true, 50000],
      [false, 0],
    ]);
  });

  it('property: buckets sum to the positive balance', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: -200000, max: 500000 }), fc.integer({ min: 0, max: 400 })), {
          maxLength: 12,
        }),
        fc.array(fc.integer({ min: -100000, max: 500000 }), { maxLength: 6 }),
        (cs, ps) => {
          const charges = cs.map(([a, d]) =>
            ch({
              amountAgorot: a,
              date: new Date(Date.UTC(2026, 9, 14) - d * 86400000).toISOString().slice(0, 10),
            }),
          );
          const credits = ps.map((p) => cr(p));
          const b = agingOf(charges, credits, '2026-10-14');
          const bal = balanceOf(charges, credits);
          expect(b.reduce((s, x) => s + x, 0)).toBe(Math.max(0, bal));
        },
      ),
    );
  });

  it('ledger lists charges before payments on the same day with a running balance', () => {
    const lines = buildLedger([ch({ amountAgorot: 1000, date: '2026-01-01' })], [cr(400, '2026-01-01')]);
    expect(lines.map((l) => [l.kind, l.balanceAgorot])).toEqual([
      ['charge', 1000],
      ['payment', 600],
    ]);
  });
});
