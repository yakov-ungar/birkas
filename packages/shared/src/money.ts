/**
 * Money is always an integer number of agorot. These helpers are the only place
 * where shekel strings are converted, so no float ever reaches storage or arithmetic.
 */
export type Agorot = number;

export function isAgorot(v: unknown): v is Agorot {
  return typeof v === 'number' && Number.isSafeInteger(v);
}

/** Parses user input like "1,234.5" or "₪ 1234.50" into agorot. Returns null when invalid. */
export function parseShekels(input: string): Agorot | null {
  const s = input.replace(/[₪\s,]/g, '').replace(/^‎/, '');
  const m = /^(-?)(\d{1,10})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const whole = Number(m[2]);
  const frac = Number((m[3] ?? '').padEnd(2, '0'));
  const v = whole * 100 + frac;
  return m[1] ? -v : v;
}

const NF = new Intl.NumberFormat('he-IL', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const NF2 = new Intl.NumberFormat('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "₪9,600" or "₪9,600.50"; negative amounts get an LRM so the minus stays on the left in RTL text. */
export function formatMoney(a: Agorot, opts: { fixed?: boolean } = {}): string {
  const abs = Math.abs(a) / 100;
  const body = (opts.fixed || a % 100 !== 0 ? NF2 : NF).format(abs);
  return `${a < 0 ? '‎-' : ''}₪${body}`;
}

/** Amount as a plain decimal string for inputs and CSV ("1234.50"). */
export function agorotToInput(a: Agorot): string {
  const sign = a < 0 ? '-' : '';
  const abs = Math.abs(a);
  const frac = abs % 100;
  return `${sign}${Math.floor(abs / 100)}${frac ? `.${String(frac).padStart(2, '0')}` : ''}`;
}

/** Rounds agorot to the nearest whole shekel, half up (decision C1). */
export const roundToShekel = (a: Agorot): Agorot => Math.sign(a) * Math.floor((Math.abs(a) + 50) / 100) * 100;

/**
 * pct% of an amount, rounded half up to a whole shekel (as the demo does with Math.round on shekels).
 * Exact integer math: pct is used with up to two decimals.
 */
export function percentOf(a: Agorot, pct: number): Agorot {
  const p = Math.round(pct * 100); // basis points * 1
  const num = Math.abs(a) * p; // agorot * pct * 100
  const shekels = Math.floor((num + 500_000) / 1_000_000); // / (100 pct * 100 bp * 100 agorot)
  return Math.sign(a) * shekels * 100;
}
