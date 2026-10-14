/** Recurring plans without an end keep this many future charges scheduled (decision C10). */
export const ROLLING_AHEAD = 12;

const pad = (n: number) => String(n).padStart(2, '0');

/** Same day of month `i` months after start, clamped to the month's last day (demo's `mk`). */
export function monthlyDate(start: string, i: number, dayOfMonth?: number): string {
  const [y, m, d] = start.split('-').map(Number) as [number, number, number];
  const day = dayOfMonth ?? d;
  const total = m - 1 + i;
  const yy = y + Math.floor(total / 12);
  const mm = (total % 12) + 1;
  const dim = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  return `${yy}-${pad(mm)}-${pad(Math.min(day, dim))}`;
}

export interface ScheduledCharge {
  seq: number;
  dueDate: string;
  amountAgorot: number;
}

/**
 * Installments: whole-shekel parts, the last one absorbs the difference (demo, decision C1).
 * Recurring: a fixed amount every month; `count` 0 means open-ended (first ROLLING_AHEAD charges).
 */
export function buildSchedule(
  type: 'installments' | 'recurring',
  amountAgorot: number,
  count: number,
  startDate: string,
): ScheduledCharge[] {
  if (!Number.isSafeInteger(amountAgorot) || amountAgorot <= 0)
    throw new Error('amount must be a positive integer');
  if (type === 'installments') {
    if (count < 2 || count > 36) throw new Error('installments: 2..36');
    const per = Math.floor(amountAgorot / count / 100) * 100;
    if (per <= 0) throw new RangeError('הסכום קטן מדי לפריסה למספר התשלומים שנבחר');
    return Array.from({ length: count }, (_, i) => ({
      seq: i + 1,
      dueDate: monthlyDate(startDate, i),
      amountAgorot: i === count - 1 ? amountAgorot - per * (count - 1) : per,
    }));
  }
  const n = count > 0 ? count : ROLLING_AHEAD;
  return Array.from({ length: n }, (_, i) => ({
    seq: i + 1,
    dueDate: monthlyDate(startDate, i),
    amountAgorot,
  }));
}

export const planLabel = (type: string, count: number, total: number) =>
  type === 'installments'
    ? `פריסה ל-${total} תשלומים`
    : `חיוב חוזר חודשי${count ? ` (${count} חודשים)` : ' (ללא הגבלה)'}`;
