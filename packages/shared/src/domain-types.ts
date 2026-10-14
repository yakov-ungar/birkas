/** Charge types from the demo (TY), plus "check_fee" used for returned checks. */
export const CHARGE_TYPES = {
  tuition: 'שכר לימוד',
  reg: 'דמי רישום',
  trip: 'טיול',
  bus: 'הסעות',
  meals: 'ארוחות',
  books: 'ספרים וציוד',
  other: 'אחר',
  disc: 'הנחה / מלגה',
  sib: 'הנחת אחים',
  carry: 'יתרה משנה קודמת',
  check_fee: 'עמלת שיק חוזר',
} as const;
export type ChargeType = keyof typeof CHARGE_TYPES;
export const CHARGE_TYPE_KEYS = Object.keys(CHARGE_TYPES) as ChargeType[];
/** Types a user may pick for a manual or catalog charge (demo: everything except disc, sib, tuition, carry). */
export const MANUAL_CHARGE_TYPES: ChargeType[] = ['reg', 'trip', 'bus', 'meals', 'books', 'other'];

export const DISCOUNT_REASONS = ['מלגה', 'צורך משפחתי', 'בן / בת צוות', 'הנחה מיוחדת', 'אחר'] as const;

export const STUDENT_STATUS = { active: 'פעיל', left: 'עזב', graduated: 'סיים' } as const;
export type StudentStatus = keyof typeof STUDENT_STATUS;

export const PAYMENT_METHODS = {
  card: 'אשראי',
  transfer: 'העברה',
  cash: 'מזומן',
  check: 'שיק',
  standing_order: 'הוראת קבע',
} as const;
export type PaymentMethod = keyof typeof PAYMENT_METHODS;

export const DOC_TYPES = { receipt: 'קבלה', credit_note: 'אישור זיכוי', refund: 'אישור החזר' } as const;
export type DocType = keyof typeof DOC_TYPES;

export const DEFAULT_GRADES = ["א'", "ב'", "ג'", "ד'", "ה'", "ו'"];

/** Accepts "א", "א'", "א׳" and returns the canonical grade from the list, or null. */
export function normalizeGrade(input: string, grades: readonly string[]): string | null {
  const key = (s: string) =>
    s
      .trim()
      .replace(/[׳'"`]/g, '')
      .replace(/^כיתה\s*/, '');
  const k = key(input);
  return grades.find((g) => key(g) === k) ?? null;
}

/** Digits only, with a leading 972 turned into 0, for matching phone numbers. */
export function normalizePhone(p: string): string {
  let d = p.replace(/\D/g, '');
  if (d.startsWith('972')) d = '0' + d.slice(3);
  return d;
}

export const isoDate = /^\d{4}-\d{2}-\d{2}$/;
