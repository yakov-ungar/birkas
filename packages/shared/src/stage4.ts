import { z } from 'zod';
import { isoDate } from './domain-types';

const id = z.string().min(1).max(40);
const text = (max: number) => z.string().trim().max(max);
const date = z.string().regex(isoDate, 'תאריך לא תקין');

export const CHECK_STATUS = {
  pending: ['ממתין', 'o'],
  deposited: ['הופקד', 'g'],
  returned: ['חזר', 'r'],
  cancelled: ['בוטל', 'gr'],
} as const;
export type CheckStatus = keyof typeof CHECK_STATUS;

export const checkCreateSchema = z
  .object({
    idempotencyKey: z.string().uuid(),
    studentId: id,
    number: text(20).min(1),
    bank: text(80).min(1),
    amountAgorot: z.number().int().positive('יש להזין סכום חיובי').max(100_000_000),
    dueDate: date,
  })
  .strict();

export const cashOpenSchema = z
  .object({ openingFloatAgorot: z.number().int().min(0).max(10_000_000) })
  .strict();
export const cashCloseSchema = z
  .object({
    countedAgorot: z.number().int().min(0).max(100_000_000),
    notes: text(300).optional(),
    /** Must be true when counted differs from expected (the demo asks before closing). */
    acceptDifference: z.boolean().optional(),
  })
  .strict();

export const bankImportSchema = z
  .object({ fileName: text(200).min(1), contentBase64: z.string().min(1).max(7_000_000) })
  .strict();
export const bankRegisterSchema = z.object({ familyId: id }).strict();

export const masavCreateSchema = z.object({ chargeDate: date }).strict();
export const masavReturnSchema = z.object({ reason: text(120).min(1, 'יש לציין סיבת החזרה') }).strict();

export interface CheckRow {
  id: string;
  dueDate: string;
  studentId: string;
  studentName: string;
  number: string;
  bank: string;
  amountAgorot: number;
  status: CheckStatus;
  dueReached: boolean;
  receiptId: string | null;
}

export interface CashState {
  open: {
    id: string;
    openedAt: string;
    openedBy: string;
    openingFloatAgorot: number;
    cashInAgorot: number;
    expectedAgorot: number;
    transactions: number;
    /** Money received while the drawer is open, by payment method (cash counted in the drawer, the rest for reference). */
    byMethod: { method: string; label: string; amountAgorot: number; count: number }[];
  } | null;
  history: {
    id: string;
    closedAt: string;
    closedBy: string;
    expectedAgorot: number;
    countedAgorot: number;
    diffAgorot: number;
    notes: string;
  }[];
}

export interface BankTxnRow {
  id: string;
  date: string;
  description: string;
  reference: string;
  amountAgorot: number;
  status: 'pending' | 'registered' | 'ignored';
  matchLevel: 'high' | 'medium' | 'none';
  matchReason: string | null;
  suggestedFamily: { id: string; name: string } | null;
  familyName: string | null;
  receiptId: string | null;
}

export interface StandingOrderRow {
  planId: string;
  studentName: string;
  amountAgorot: number;
  bank: string;
  branch: string;
  accountLast4: string;
  next: { dueDate: string; status: string } | null;
}

export interface MasavExportRow {
  id: string;
  createdAt: string;
  chargeDate: string;
  count: number;
  totalAgorot: number;
  status: 'submitted' | 'settled';
  items: {
    id: string;
    studentName: string;
    amountAgorot: number;
    status: 'submitted' | 'paid' | 'returned';
    returnReason: string | null;
  }[];
}
