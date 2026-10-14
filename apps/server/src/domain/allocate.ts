export interface KidBalance {
  studentId: string;
  balanceAgorot: number;
}

export interface Part {
  studentId: string;
  amountAgorot: number;
}

/**
 * The demo's `allocate`: kids sorted by balance (largest debt first, stable for ties),
 * each gets up to its debt; any remainder goes to the first part, or to the first kid
 * when nobody owes anything. The sum of parts always equals the amount.
 */
export function allocate(kids: readonly KidBalance[], amountAgorot: number): Part[] {
  if (!Number.isSafeInteger(amountAgorot) || amountAgorot <= 0)
    throw new Error('amount must be a positive integer');
  if (!kids.length) throw new Error('family has no students');
  const sorted = kids
    .map((k, i) => ({ ...k, i }))
    .sort((a, b) => b.balanceAgorot - a.balanceAgorot || a.i - b.i);
  let left = amountAgorot;
  const parts: Part[] = [];
  for (const k of sorted) {
    if (left <= 0 || k.balanceAgorot <= 0) continue;
    const x = Math.min(left, k.balanceAgorot);
    parts.push({ studentId: k.studentId, amountAgorot: x });
    left -= x;
  }
  if (left > 0) {
    if (parts.length) parts[0]!.amountAgorot += left;
    else parts.push({ studentId: sorted[0]!.studentId, amountAgorot: left });
  }
  return parts;
}

/** Validates a manual allocation against the family and the amount. Returns a Hebrew error or null. */
export function allocationProblem(
  parts: readonly Part[],
  amountAgorot: number,
  familyStudentIds: ReadonlySet<string>,
): string | null {
  if (!parts.length) return 'יש לחלק את הסכום לפחות לתלמיד אחד';
  const seen = new Set<string>();
  let sum = 0;
  for (const p of parts) {
    if (!familyStudentIds.has(p.studentId)) return 'תלמיד שאינו שייך למשפחה';
    if (seen.has(p.studentId)) return 'תלמיד מופיע פעמיים בחלוקה';
    if (!Number.isSafeInteger(p.amountAgorot) || p.amountAgorot < 0) return 'סכום לא תקין בחלוקה';
    seen.add(p.studentId);
    sum += p.amountAgorot;
  }
  if (sum !== amountAgorot) return 'סכום החלוקה חייב להיות שווה לסכום התשלום';
  return null;
}
