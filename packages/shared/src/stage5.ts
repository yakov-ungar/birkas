import { z } from 'zod';
import { isoDate } from './domain-types';

const text = (max: number) => z.string().trim().max(max);

export const CHANNELS = { sms: 'SMS', whatsapp: 'וואטסאפ', email: 'מייל' } as const;
export type ChannelKey = keyof typeof CHANNELS;
export const NOTE_TYPES = {
  call: 'שיחה',
  message: 'הודעה',
  meeting: 'פגישה',
  promise: 'הבטחת תשלום',
} as const;
export type NoteType = keyof typeof NOTE_TYPES;
export const TEMPLATE_PLACEHOLDERS = [
  '{הורה}',
  '{משפחה}',
  '{תלמיד}',
  '{יתרה}',
  '{קישור}',
  '{תאריך}',
  '{סכום}',
  '{סיבה}',
];

export const noteCreateSchema = z
  .object({
    type: z.enum(['call', 'message', 'meeting', 'promise']),
    note: text(500).min(1),
    promiseDate: z.string().regex(isoDate).optional(),
    promiseAgorot: z.number().int().positive().max(100_000_000).optional(),
  })
  .strict()
  .refine((v) => v.type !== 'promise' || (v.promiseDate && v.promiseAgorot), {
    message: 'בהבטחת תשלום חובה תאריך וסכום',
    path: ['promiseDate'],
  });

export const ruleUpdateSchema = z
  .object({
    channel: z.enum(['sms', 'whatsapp', 'email']),
    enabled: z.boolean(),
    template: text(1000).min(1),
  })
  .strict();

const group = z.union([z.enum(['all', 'big', 'aged', 'fail']), z.string().regex(/^grade:.{1,20}$/)]);
export const groupSendSchema = z
  .object({
    group,
    channel: z.enum(['sms', 'whatsapp', 'email']),
    template: text(1000).min(1, 'יש להזין תוכן'),
    expectedCount: z.number().int().positive().optional(),
  })
  .strict();

export const statementSendSchema = z
  .object({
    channel: z.enum(['email', 'sms', 'whatsapp']).default('email'),
    email: z.string().trim().toLowerCase().email().max(200).optional(),
  })
  .strict()
  .refine((v) => v.channel !== 'email' || !!v.email, { message: 'יש להזין כתובת מייל', path: ['email'] });

export type PromiseStatus = 'pending' | 'kept' | 'broken';
export interface PromiseInfo {
  noteId: string;
  date: string;
  amountAgorot: number;
  status: PromiseStatus;
}

export interface ContactNoteRow {
  id: string;
  date: string;
  byName: string;
  type: NoteType;
  note: string;
  promise: PromiseInfo | null;
}

export interface DebtorRow {
  familyId: string;
  name: string;
  balanceAgorot: number;
  agingLabel: string;
  lastContact: string | null;
  daysSinceContact: number | null;
  promise: PromiseInfo | null;
}

export interface RuleRow {
  key: 'pre_charge' | 'charge_failed' | 'debt_30' | 'receipt_auto';
  name: string;
  enabled: boolean;
  channel: ChannelKey;
  template: string;
}

export interface BatchRow {
  id: string;
  at: string;
  channel: ChannelKey;
  recipients: number;
  sent: number;
  queued: number;
  failed: number;
  template: string;
  source: 'manual' | 'auto';
  ruleName: string | null;
}
