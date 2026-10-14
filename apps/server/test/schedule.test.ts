import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { buildSchedule, monthlyDate } from '../src/domain/schedule';

describe('schedule (demo mk)', () => {
  it('splits into whole shekels and the last payment absorbs the difference', () => {
    const s = buildSchedule('installments', 600000, 6, '2026-10-05');
    expect(s.map((x) => x.amountAgorot)).toEqual([100000, 100000, 100000, 100000, 100000, 100000]);
    const t = buildSchedule('installments', 1000050, 3, '2026-10-05');
    expect(t.map((x) => x.amountAgorot)).toEqual([333300, 333300, 333450]);
  });

  it('keeps the day of month and clamps to short months', () => {
    expect(buildSchedule('installments', 400000, 4, '2026-01-31').map((x) => x.dueDate)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
    expect(monthlyDate('2027-12-15', 2)).toBe('2028-02-15');
    expect(monthlyDate('2028-01-30', 1)).toBe('2028-02-29');
  });

  it('recurring: fixed monthly amount, limited or 12 ahead when open-ended', () => {
    expect(buildSchedule('recurring', 80000, 4, '2026-10-08')).toHaveLength(4);
    const open = buildSchedule('recurring', 80000, 0, '2026-10-08');
    expect(open).toHaveLength(12);
    expect(open.every((x) => x.amountAgorot === 80000)).toBe(true);
  });

  it('rejects an amount too small for the count', () => {
    expect(() => buildSchedule('installments', 500, 6, '2026-10-01')).toThrow(/קטן מדי/);
  });

  it('property: installments always sum to the total and only the last differs', () => {
    fc.assert(
      fc.property(fc.integer({ min: 3600, max: 50_000_000 }), fc.integer({ min: 2, max: 36 }), (total, n) => {
        fc.pre(Math.floor(total / n / 100) > 0);
        const s = buildSchedule('installments', total, n, '2026-10-01');
        expect(s.reduce((a, x) => a + x.amountAgorot, 0)).toBe(total);
        expect(new Set(s.slice(0, -1).map((x) => x.amountAgorot)).size).toBe(1);
        expect(s.slice(0, -1).every((x) => x.amountAgorot % 100 === 0)).toBe(true);
        expect(s.at(-1)!.amountAgorot).toBeGreaterThanOrEqual(s[0]!.amountAgorot);
      }),
    );
  });
});
