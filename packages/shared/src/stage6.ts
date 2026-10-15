import { z } from 'zod';
import { DISCOUNT_REASONS, isoDate } from './domain-types';
import { newCardSchema } from './schemas-finance';
import { standingOrderSchema } from './schemas-plans';

const id = z.string().min(1).max(40);
const text = (max: number) => z.string().trim().max(max);
const phone = z
  .string()
  .trim()
  .min(7, 'מספר טלפון לא תקין')
  .max(20)
  .regex(/^[\d+\-\s()]+$/, 'מספר טלפון לא תקין');
const email = z.union([z.literal(''), z.string().trim().toLowerCase().email('כתובת מייל לא תקינה').max(200)]);

// ---------- parent sign-in (decision C15) ----------

export const portalLoginStartSchema = z
  .object({
    /** Phone or email registered with the family. */
    contact: text(200).min(3, 'יש להזין טלפון או מייל').optional(),
    /** Signed link from a message ({קישור}); identifies the family without typing. */
    link: z.string().min(10).max(300).optional(),
    channel: z.enum(['sms', 'email', 'voice']).default('sms'),
  })
  .strict()
  .refine((v) => !!v.contact !== !!v.link, { message: 'יש להזין טלפון או מייל', path: ['contact'] });

export const portalLoginVerifySchema = z
  .object({
    challengeId: z.string().min(10).max(60),
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, 'הקוד מורכב מ-6 ספרות'),
    trustDevice: z.boolean().default(false),
  })
  .strict();

export interface PortalLoginStart {
  challengeId: string;
  /** Masked destination, shown only when the family is already known (signed link). */
  sentTo: string | null;
}

// ---------- requests ----------

export const REQUEST_TYPES = { installments: 'פריסה', discount: 'הנחה', contact: 'עדכון פרטים' } as const;
export type RequestType = keyof typeof REQUEST_TYPES;
export const REQUEST_STATUS = { pending: 'ממתין', approved: 'אושרה', rejected: 'נדחתה' } as const;
export type RequestStatus = keyof typeof REQUEST_STATUS;
/** The demo's choices for the preferred method (portalPlan). */
export const PREFERRED_METHODS = { card: 'כרטיס', standing_order: 'הוראת קבע', transfer: 'העברה' } as const;
export const INSTALLMENT_MONTHS = [3, 6, 9, 12] as const;

export const portalRequestSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('installments'),
      months: z.union([z.literal(3), z.literal(6), z.literal(9), z.literal(12)]),
      method: z.enum(['card', 'standing_order', 'transfer']),
      note: text(500).default(''),
    })
    .strict(),
  z
    .object({
      type: z.literal('discount'),
      pct: z.number().min(1, 'אחוז בין 1 ל-100').max(100, 'אחוז בין 1 ל-100'),
      /** Decision C12: one child, or null for all the children. */
      studentId: id.nullable(),
      note: text(500).default(''),
    })
    .strict(),
  z.object({ type: z.literal('contact'), phone, email: email.default('') }).strict(),
]);
export type PortalRequestInput = z.input<typeof portalRequestSchema>;

export type RequestDetails =
  | { type: 'installments'; months: number; method: keyof typeof PREFERRED_METHODS }
  | { type: 'discount'; pct: number; studentId: string | null }
  | { type: 'contact'; phone: string; email: string };

export interface RequestRow {
  id: string;
  createdAt: string;
  familyId: string;
  familyName: string;
  /** Who the request is about: one child's name, or all of the family's children. */
  studentsLabel: string;
  type: RequestType;
  details: RequestDetails;
  detailsText: string;
  note: string;
  status: RequestStatus;
  rejectReason: string | null;
  resultSummary: string | null;
  decidedByName: string | null;
}

export const requestDetailsText = (d: RequestDetails): string =>
  d.type === 'installments'
    ? `${d.months} חודשים · ${PREFERRED_METHODS[d.method]}`
    : d.type === 'discount'
      ? `${d.pct}%`
      : `טלפון ${d.phone}${d.email ? ` · ${d.email}` : ''}`;

/** Prefilled approval form (demo reqApprove, decisions C11 and C12). */
export interface ApprovalForm {
  request: RequestRow;
  installments?: {
    startDate: string;
    count: number;
    students: {
      studentId: string;
      fullName: string;
      balanceAgorot: number;
      method: 'card' | 'standing_order' | 'transfer';
      cards: { id: string; label: string; isDefault: boolean }[];
    }[];
  };
  discount?: {
    students: { studentId: string; fullName: string; tuitionAgorot: number; pct: number }[];
  };
  contact?: { current: { phone: string; email: string }; requested: { phone: string; email: string } };
}

export const approveSchema = z
  .object({
    plans: z
      .array(
        z
          .object({
            studentId: id,
            count: z.number().int().min(2).max(36),
            startDate: z.string().regex(isoDate, 'תאריך לא תקין'),
            method: z.enum(['card', 'standing_order', 'transfer']),
            cardId: id.optional(),
            standingOrder: standingOrderSchema.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(20)
      .optional(),
    discounts: z
      .array(
        z
          .object({
            studentId: id,
            kind: z.enum(['pct', 'amount']),
            value: z.number().positive('יש להזין ערך חיובי'),
            reason: z.enum(DISCOUNT_REASONS),
            note: text(200).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(20)
      .optional(),
  })
  .strict();
export type ApproveInput = z.infer<typeof approveSchema>;

export const rejectSchema = z.object({ reason: text(300).min(1, 'יש לציין סיבה') }).strict();

// ---------- portal view ----------

export const portalPaySchema = z
  .object({
    amountAgorot: z.number().int().positive('יש להזין סכום חיובי').max(100_000_000),
    idempotencyKey: z.string().uuid(),
    cardId: id.optional(),
    newCard: newCardSchema.optional(),
  })
  .strict()
  .refine((v) => !!v.cardId !== !!v.newCard, { message: 'יש לבחור כרטיס', path: ['cardId'] });

export const portalCardSchema = z
  .object({ studentId: id, card: newCardSchema.omit({ save: true }) })
  .strict();

export interface PortalView {
  schoolName: string;
  parentName: string;
  familyName: string;
  balanceAgorot: number;
  students: { id: string; fullName: string; grade: string; balanceAgorot: number }[];
  /** Last 6 ledger lines, newest first (demo rPortal). */
  recent: { date: string; description: string; debitAgorot: number; creditAgorot: number }[];
  /** Last 4 receipts that were not cancelled. */
  receipts: { id: string; number: number; date: string; amountAgorot: number }[];
  cards: { id: string; studentName: string; last4: string; brand: string; exp: string; expired: boolean }[];
  requests: {
    id: string;
    createdAt: string;
    type: RequestType;
    detailsText: string;
    status: RequestStatus;
    rejectReason: string | null;
  }[];
  hostedFieldsUrl: string;
  /** Staff preview: actions are disabled (decision B8). */
  readOnly: boolean;
}

export interface PortalMe extends PortalView {
  csrfToken: string;
  testMode: boolean;
}
