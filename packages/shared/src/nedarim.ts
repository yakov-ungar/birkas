import { z } from 'zod';
import type { PaymentResult } from './finance-types';

const id = z.string().min(1).max(40);
const amount = z.number().int().positive('יש להזין סכום חיובי').max(100_000_000);

/** Staff: start a card payment in the Nedarim Plus iframe (same targets as a regular payment). */
export const nedarimStartSchema = z
  .object({
    idempotencyKey: z.string().uuid(),
    familyId: id.optional(),
    studentId: id.optional(),
    amountAgorot: amount,
    allocations: z
      .array(z.object({ studentId: id, amountAgorot: z.number().int().min(0) }).strict())
      .max(20)
      .optional(),
  })
  .strict()
  .refine((v) => !!v.familyId !== !!v.studentId, { message: 'יש לבחור משפחה או תלמיד', path: ['familyId'] });

export const portalNedarimStartSchema = z
  .object({ amountAgorot: amount, idempotencyKey: z.string().uuid() })
  .strict();

/** How card payments are taken right now. */
export interface CardMode {
  mode: 'hosted' | 'nedarim';
  iframeUrl: string | null;
}

export interface NedarimStart {
  intentId: string;
  iframeUrl: string;
  /** Origins the iframe may answer from. */
  origins: string[];
  /** The FinishTransaction2 fields to post to the iframe. */
  transaction: Record<string, string>;
}

export interface NedarimStatus {
  status: 'pending' | 'paid' | 'failed';
  message: string | null;
  result: PaymentResult | null;
}
