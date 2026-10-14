import { z } from 'zod';
import { isoDate } from './domain-types';

// ---------- reports ----------

/** The demo's 9 reports (REP), plus "transactions by period" (plan stage 7). */
export const REPORTS = {
  debt: 'חייבים וגיל חוב',
  methods: 'סיכום לפי אמצעי תשלום',
  monthly: 'גבייה לפי חודש',
  grades: 'גבייה לפי כיתה',
  discounts: 'הנחות ומלגות',
  failed: 'חיובים שנכשלו',
  checks: 'שיקים',
  cash: 'סגירות קופה',
  accounting: 'ייצוא להנהלת חשבונות',
  ledger: 'תנועות לפי תקופה',
} as const;
export type ReportKey = keyof typeof REPORTS;
/** Button labels, as on the demo's reports screen. */
export const REPORT_BUTTONS: Record<ReportKey, string> = {
  debt: 'חייבים וגיל חוב',
  methods: 'לפי אמצעי תשלום',
  monthly: 'לפי חודש',
  grades: 'לפי כיתה',
  discounts: 'הנחות ומלגות',
  failed: 'חיובים שנכשלו',
  checks: 'שיקים',
  cash: 'סגירות קופה',
  accounting: 'הנהלת חשבונות',
  ledger: 'תנועות לפי תקופה',
};
/** Reports that take a date range; "debt" is as of today and "grades" is per school year. */
export const DATED_REPORTS: ReportKey[] = [
  'methods',
  'monthly',
  'discounts',
  'failed',
  'checks',
  'cash',
  'accounting',
  'ledger',
];

export const reportQuerySchema = z
  .object({
    from: z.string().regex(isoDate, 'תאריך לא תקין').optional(),
    to: z.string().regex(isoDate, 'תאריך לא תקין').optional(),
    /** Decision C16: "by grade" filtered by school year, default the active one. */
    year: z.string().trim().min(1).max(20).optional(),
  })
  .strict()
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    message: 'תאריך ההתחלה אחרי תאריך הסיום',
    path: ['to'],
  });

export type ColumnKind = 'text' | 'money' | 'date' | 'pct' | 'number';
export type Cell = string | number | null;

export interface Report {
  key: ReportKey;
  title: string;
  columns: { label: string; kind: ColumnKind }[];
  rows: Cell[][];
  /** Sum row for money columns (null where not summed). */
  totals: Cell[] | null;
  /** Filters actually applied, for the header and the CSV file name. */
  filters: { from?: string; to?: string; year?: string };
  years?: string[];
}

// ---------- general settings ----------

export const generalPatchSchema = z
  .object({
    schoolName: z.string().trim().min(1, 'שדה חובה').max(120),
    siblingPct: z.tuple([
      z.literal(0),
      z.number().int('מספר שלם').min(0, 'אחוזי הנחה בין 0 ל-100').max(100, 'אחוזי הנחה בין 0 ל-100'),
      z.number().int('מספר שלם').min(0, 'אחוזי הנחה בין 0 ל-100').max(100, 'אחוזי הנחה בין 0 ל-100'),
    ]),
    checkReturnFeeAgorot: z.number().int().min(0, 'עמלה לא תקינה').max(100_000),
    autoRunTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'שעה לא תקינה'),
    backupFrequency: z.enum(['daily', 'weekly']),
    grades: z.array(z.string().trim().min(1).max(20)).min(1, 'יש להגדיר לפחות כיתה אחת').max(20),
  })
  .strict();
export type GeneralPatch = z.infer<typeof generalPatchSchema>;

// ---------- integrations (demo S.integ) ----------

export const INTEGRATIONS = {
  card: 'חברת סליקה (אשראי)',
  masav: 'בנק - קבצי מס״ב',
  sms: 'שירות SMS',
  whatsapp: 'וואטסאפ עסקי',
  email: 'דואר אלקטרוני (SMTP)',
  accounting: 'תוכנת הנהלת חשבונות',
} as const;
export type IntegrationKey = keyof typeof INTEGRATIONS;

export interface IntegrationRow {
  key: IntegrationKey;
  name: string;
  connected: boolean;
  mode: 'test' | 'live';
  details: string;
  /** Which provider actually runs today (a mock until stage 9). */
  provider: string;
  updatedAt: string | null;
}

export const integrationConfigSchema = z
  .object({
    username: z.string().trim().min(1, 'שדה חובה').max(200),
    secret: z.string().min(1, 'שדה חובה').max(500),
    /** Production stays closed until a real provider is chosen and approved (plan stage 9). */
    mode: z.literal('test'),
  })
  .strict();

// ---------- opening a school year ----------

export const yearOpenSchema = z
  .object({
    yearName: z.string().trim().min(1, 'שדה חובה').max(20),
    tuitionAgorot: z.number().int().positive('יש להזין סכום חיובי').max(100_000_000),
    chargeDate: z.string().regex(isoDate, 'תאריך לא תקין'),
  })
  .strict();
export type YearOpenInput = z.infer<typeof yearOpenSchema>;

export interface YearPreview {
  yearName: string;
  promoted: number;
  graduating: number;
  graduatingGrade: string;
  newCharges: number;
  totalAgorot: number;
  /** Sibling discounts the new charges will get (the demo shows the total before them). */
  siblingDiscountAgorot: number;
  previousYear: string;
}

export interface YearInfo {
  activeYearName: string;
  activeStudents: number;
  graduated: number;
  years: string[];
}
