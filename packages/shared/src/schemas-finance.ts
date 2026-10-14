import { z } from 'zod';
import { DISCOUNT_REASONS, MANUAL_CHARGE_TYPES, isoDate, type ChargeType } from './domain-types';

const id = z.string().min(1).max(40);
const date = z.string().regex(isoDate, 'תאריך לא תקין');
const positiveAgorot = z.number().int().positive('יש להזין סכום חיובי').max(100_000_000);
const text = (max: number) => z.string().trim().max(max);
const phone = z
  .string()
  .trim()
  .min(7, 'מספר טלפון לא תקין')
  .max(20)
  .regex(/^[\d+\-\s()]+$/, 'מספר טלפון לא תקין');
const email = z.union([z.literal(''), z.string().trim().toLowerCase().email().max(200)]);

export const familyFields = z
  .object({
    parentName: text(80).min(1),
    phone,
    email: email.optional(),
    address: text(200).optional(),
    note: text(500).optional(),
  })
  .strict();
export type FamilyFields = z.infer<typeof familyFields>;

export const studentCreateSchema = z
  .object({
    familyId: id.optional(),
    newFamily: familyFields.optional(),
    fullName: text(80).min(1),
    grade: text(20).min(1),
    tuitionAgorot: z.number().int().min(0).max(100_000_000),
  })
  .strict()
  .refine((v) => !!v.familyId !== !!v.newFamily, {
    message: 'יש לבחור משפחה קיימת או למלא פרטי משפחה חדשה',
    path: ['familyId'],
  });

export const studentUpdateSchema = z
  .object({
    fullName: text(80).min(1).optional(),
    grade: text(20).min(1).optional(),
    enrollSeq: z.number().int().min(1).optional(),
  })
  .strict();
export const studentStatusSchema = z.object({ status: z.enum(['active', 'left', 'graduated']) }).strict();

const manualType = z.enum(MANUAL_CHARGE_TYPES as [ChargeType, ...ChargeType[]]);

export const chargeCreateSchema = z
  .object({
    studentId: id,
    type: manualType,
    description: text(120).min(1),
    amountAgorot: positiveAgorot,
    date,
  })
  .strict();

export const bulkChargeSchema = z
  .object({
    catalogItemId: id.optional(),
    description: text(120).optional(),
    amountAgorot: positiveAgorot.optional(),
    /** null/absent = all active students */
    grade: text(20).nullable().optional(),
    date,
  })
  .strict()
  .refine((v) => v.catalogItemId || (v.description && v.amountAgorot), {
    message: 'בחיוב מותאם יש להזין תיאור וסכום',
    path: ['description'],
  });

export const discountCreateSchema = z
  .object({
    studentId: id,
    kind: z.enum(['pct', 'amount']),
    /** Percent (up to 2 decimals) when kind=pct; agorot when kind=amount. */
    value: z.number().positive('יש להזין ערך חיובי'),
    reason: z.enum(DISCOUNT_REASONS),
    note: text(200).optional(),
  })
  .strict();

export const reasonSchema = z.object({ reason: text(200).min(1, 'יש לציין סיבה') }).strict();

export const catalogCreateSchema = z
  .object({ name: text(80).min(1), defaultAgorot: positiveAgorot, type: manualType })
  .strict();

export const allocationSchema = z
  .array(z.object({ studentId: id, amountAgorot: z.number().int().min(0) }).strict())
  .max(30);

/** New card as returned by the payment provider's hosted fields: token and metadata only, never the card number. */
export const newCardSchema = z
  .object({
    token: z.string().min(8).max(200),
    last4: z.string().regex(/^\d{4}$/),
    brand: text(30),
    expMonth: z.number().int().min(1).max(12),
    expYear: z.number().int().min(2000).max(2100),
    holderName: text(80).min(1),
    save: z.boolean(),
  })
  .strict();

export const paymentDetailsSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('cash'), receivedBy: text(80).min(1) }).strict(),
  z
    .object({ method: z.literal('transfer'), bank: text(80).min(1), reference: text(60).min(1), date })
    .strict(),
  z
    .object({ method: z.literal('check'), number: text(20).min(1), bank: text(80).min(1), dueDate: date })
    .strict(),
  z.object({ method: z.literal('card'), cardId: id.optional(), newCard: newCardSchema.optional() }).strict(),
]);

export const paymentCreateSchema = z
  .object({
    idempotencyKey: z.string().uuid(),
    familyId: id.optional(),
    studentId: id.optional(),
    amountAgorot: positiveAgorot,
    allocations: allocationSchema.optional(),
    details: paymentDetailsSchema,
  })
  .strict()
  .refine((v) => !!v.familyId !== !!v.studentId, { message: 'יש לבחור משפחה או תלמיד', path: ['familyId'] });
export type PaymentCreateInput = z.infer<typeof paymentCreateSchema>;

export const refundCreateSchema = z
  .object({
    idempotencyKey: z.string().uuid(),
    studentId: id,
    amountAgorot: positiveAgorot,
    method: z.enum(['transfer', 'cash']),
    reason: text(200).min(1, 'יש לציין סיבה'),
  })
  .strict();

export const emailSchema = z.object({ email: z.string().trim().toLowerCase().email().max(200) }).strict();
