/** Matching incoming bank transfers to families by name and amount (plan section 8). */

export interface FamilyCandidate {
  id: string;
  name: string;
  parentName: string;
  balanceAgorot: number;
  /** Open plan installments by transfer (or any open installment) with their amounts. */
  expected: { planChargeId: string; amountAgorot: number }[];
}

export interface Match {
  familyId: string | null;
  planChargeId: string | null;
  level: 'high' | 'medium' | 'none';
  reason: string | null;
}

const norm = (s: string) =>
  ` ${s
    .replace(/[׳'"`.,\-_/\\()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()} `;
const words = (s: string) =>
  norm(s)
    .trim()
    .split(' ')
    .filter((w) => w.length >= 2);

export function matchTransfer(description: string, amountAgorot: number, families: FamilyCandidate[]): Match {
  const d = norm(description);
  const has = (w: string) => d.includes(` ${w} `);
  const scored = families.map((f) => {
    const parent = words(f.parentName);
    const surname = words(f.name.replace(/^משפחת\s*/, ''));
    const fullName = parent.length >= 2 && parent.every(has);
    const surnameHit = surname.length > 0 && surname.every(has);
    const name = fullName ? 2 : surnameHit ? 1 : 0;
    const plan = f.expected.find((e) => e.amountAgorot === amountAgorot) ?? null;
    const amount = !!plan || (f.balanceAgorot > 0 && f.balanceAgorot === amountAgorot);
    return { f, name, amount, plan };
  });
  const strong = scored.filter((s) => s.name === 2);
  const named = strong.length ? strong : scored.filter((s) => s.name === 1);
  const pick = (s: (typeof scored)[number], level: Match['level'], reason: string): Match => ({
    familyId: s.f.id,
    planChargeId: s.plan?.planChargeId ?? null,
    level,
    reason,
  });
  if (named.length === 1) {
    const s = named[0]!;
    if (s.amount) return pick(s, 'high', s.plan ? 'שם ההורה וסכום של תשלום בתוכנית' : 'שם ההורה וסכום היתרה');
    return pick(s, 'medium', s.name === 2 ? 'שם ההורה' : 'שם המשפחה');
  }
  if (named.length > 1) {
    const both = named.filter((s) => s.amount);
    if (both.length === 1) return pick(both[0]!, 'high', 'שם וסכום');
    return { familyId: null, planChargeId: null, level: 'none', reason: 'כמה משפחות מתאימות לשם' };
  }
  const byPlan = scored.filter((s) => s.plan);
  if (byPlan.length === 1) return pick(byPlan[0]!, 'medium', 'סכום של תשלום בתוכנית');
  return { familyId: null, planChargeId: null, level: 'none', reason: null };
}

/** Accepts 31/12/2026, 31.12.26, 2026-12-31. */
export function parseBankDate(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(t);
  if (!m) return null;
  const y = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
  const mm = m[2]!.padStart(2, '0');
  const dd = m[1]!.padStart(2, '0');
  if (+mm < 1 || +mm > 12 || +dd < 1 || +dd > 31) return null;
  return `${y}-${mm}-${dd}`;
}
