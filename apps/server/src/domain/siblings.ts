import { percentOf } from '@tuition/shared';

export interface SiblingInput {
  studentId: string;
  active: boolean;
  enrollSeq: number;
  /** Net tuition of the active year. */
  tuitionAgorot: number;
}

/**
 * The demo's `recalcSib`: active kids ordered by enrollment; the first pays full,
 * the second gets pct[1]%, the third and later pct[2]% of their own tuition.
 * Returns the required discount (positive agorot) for every student given.
 */
export function siblingDiscounts(
  students: readonly SiblingInput[],
  pct: readonly number[],
): Map<string, number> {
  const out = new Map<string, number>(students.map((s) => [s.studentId, 0]));
  const active = students.filter((s) => s.active).sort((a, b) => a.enrollSeq - b.enrollSeq);
  active.forEach((s, i) => {
    const p = pct[Math.min(i, pct.length - 1)] ?? 0;
    if (i > 0 && p > 0 && s.tuitionAgorot > 0) out.set(s.studentId, percentOf(s.tuitionAgorot, p));
  });
  return out;
}
