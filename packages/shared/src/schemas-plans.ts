import { z } from 'zod';
import { isoDate } from './domain-types';
import { newCardSchema } from './schemas-finance';

const id = z.string().min(1).max(40);
const text = (max: number) => z.string().trim().max(max);

export const PLAN_METHODS = { card: 'כרטיס', standing_order: 'הוראת קבע', transfer: 'העברה' } as const;
export type PlanMethod = keyof typeof PLAN_METHODS;

export const CONSENT_METHODS = {
  phone: 'בטלפון',
  written: 'בכתב',
  meeting: 'בפגישה',
  portal: 'בפורטל ההורים',
} as const;
export type ConsentMethod = keyof typeof CONSENT_METHODS;

export const standingOrderSchema = z
  .object({
    bank: text(40).min(1),
    branch: z
      .string()
      .trim()
      .regex(/^\d{1,4}$/, 'מספר סניף לא תקין'),
    account: z
      .string()
      .trim()
      .regex(/^\d{2,12}$/, 'מספר חשבון לא תקין'),
  })
  .strict();

export const planInputSchema = z
  .object({
    studentId: id,
    type: z.enum(['installments', 'recurring']),
    amountAgorot: z.number().int().positive('יש להזין סכום חיובי').max(100_000_000),
    count: z.number().int().min(0).max(60),
    startDate: z.string().regex(isoDate, 'תאריך לא תקין'),
    method: z.enum(['card', 'standing_order', 'transfer']),
    cardId: id.optional(),
    standingOrder: standingOrderSchema.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.type === 'installments' && (v.count < 2 || v.count > 36))
      ctx.addIssue({ code: 'custom', path: ['count'], message: 'פריסה: בין 2 ל-36 תשלומים' });
    if (v.method === 'card' && !v.cardId)
      ctx.addIssue({ code: 'custom', path: ['cardId'], message: 'יש לבחור כרטיס' });
    if (v.method === 'standing_order' && !v.standingOrder)
      ctx.addIssue({ code: 'custom', path: ['standingOrder'], message: 'יש למלא פרטי הוראת קבע' });
  });
export type PlanInput = z.infer<typeof planInputSchema>;

export const planCreateSchema = z
  .object({
    plan: planInputSchema,
    idempotencyKey: z.string().uuid(),
    consent: z
      .object({ method: z.enum(['phone', 'written', 'meeting', 'portal']), confirmed: z.literal(true) })
      .strict()
      .optional(),
  })
  .strict();

export const swapCardSchema = z.object({ cardId: id }).strict();

export const cardCreateSchema = z
  .object({ studentId: id, card: newCardSchema.omit({ save: true }) })
  .strict();

/** Text the staff member confirms on the payer's behalf; stored with the plan (decision A5). */
export const consentText = (o: { label: string; amount: string; method: string; payer: string }) =>
  `${o.payer} אישר/ה ${o.method} ${o.label} בסך ${o.amount}, וכן ביטול או שינוי בהודעה לבית הספר.`;
