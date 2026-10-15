import { z } from 'zod';
import { isoDate } from './domain-types';

const id = z.string().min(1).max(40);
const phone = z.union([
  z.literal(''),
  z
    .string()
    .trim()
    .regex(/^[\d+\-\s()]{7,20}$/, 'מספר טלפון לא תקין'),
]);

export const tutorSchema = z
  .object({
    name: z.string().trim().min(1, 'שדה חובה').max(80),
    phone: phone.default(''),
  })
  .strict();

export const tutorPatchSchema = z
  .object({
    name: z.string().trim().min(1, 'שדה חובה').max(80).optional(),
    phone: phone.optional(),
    active: z.boolean().optional(),
  })
  .strict();

export const tutorSubjectsSchema = z
  .object({
    tutorSubjects: z.array(z.string().trim().min(1).max(40)).min(1, 'יש להגדיר לפחות מקצוע אחד').max(50),
  })
  .strict();

/** A private lesson for a student: a tutor, a subject from settings, and a monthly price. */
export const tutoringCreateSchema = z
  .object({
    studentId: id,
    tutorId: id,
    subject: z.string().trim().min(1, 'יש לבחור מקצוע').max(40),
    priceAgorot: z.number().int().positive('יש להזין מחיר חיובי').max(10_000_000),
    startDate: z.string().regex(isoDate, 'תאריך לא תקין'),
    note: z.string().trim().max(200).optional(),
  })
  .strict();

export const tutoringEndSchema = z.object({ endDate: z.string().regex(isoDate, 'תאריך לא תקין') }).strict();

export const tutoringRunSchema = z
  .object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'חודש לא תקין') })
  .strict();

export interface TutorRow {
  id: string;
  name: string;
  phone: string;
  active: boolean;
  /** Students currently studying with this tutor. */
  activeStudents: number;
}

export interface TutoringRow {
  id: string;
  studentId: string;
  studentName: string;
  tutorId: string;
  tutorName: string;
  subject: string;
  priceAgorot: number;
  startDate: string;
  endDate: string | null;
  note: string;
  /** Months already charged ("2026-10"). */
  chargedMonths: string[];
}

/** "2026-10" → "10/2026" */
export const monthLabel = (m: string) => `${m.slice(5, 7)}/${m.slice(0, 4)}`;
