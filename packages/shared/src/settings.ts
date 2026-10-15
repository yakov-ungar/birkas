import { z } from 'zod';

export const securitySettingsSchema = z.object({
  require2fa: z.boolean(),
  idleTimeoutMin: z.number().int().min(5).max(480),
  minPasswordLength: z.number().int().min(8).max(64),
  maxFailedLogins: z.number().int().min(3).max(20),
});
export type SecuritySettings = z.infer<typeof securitySettingsSchema>;

export const generalSettingsSchema = z.object({
  schoolName: z.string().trim().min(1).max(120),
  activeYearName: z.string().trim().min(1).max(20),
  siblingPct: z.tuple([z.literal(0), z.number().int().min(0).max(100), z.number().int().min(0).max(100)]),
  checkReturnFeeAgorot: z.number().int().min(0),
  autoRunTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  backupFrequency: z.enum(['daily', 'weekly']),
  /** Grade list in order; the last one graduates when a new year opens (decision C3). */
  grades: z.array(z.string().trim().min(1).max(20)).min(1).max(20),
  /** Stage 9: the school sends email only. SMS and WhatsApp stay available behind this switch. */
  textMessaging: z.boolean(),
  /** Subjects offered for private lessons with an אברך. */
  tutorSubjects: z.array(z.string().trim().min(1).max(40)).max(50),
});
export type GeneralSettings = z.infer<typeof generalSettingsSchema>;

export type AllSettings = SecuritySettings & GeneralSettings;

/** Defaults taken from the demo's S.cfg. */
export const DEFAULT_SETTINGS: AllSettings = {
  schoolName: 'בית ספר לדוגמה',
  activeYearName: 'תשפ״ז',
  siblingPct: [0, 10, 20],
  checkReturnFeeAgorot: 3000,
  autoRunTime: '02:00',
  backupFrequency: 'daily',
  grades: ["א'", "ב'", "ג'", "ד'", "ה'", "ו'"],
  textMessaging: false,
  tutorSubjects: ['גמרא', 'משנה', 'חומש', 'קריאה', 'חשבון', 'אנגלית'],
  require2fa: true,
  idleTimeoutMin: 30,
  minPasswordLength: 10,
  maxFailedLogins: 5,
};

export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof AllSettings)[];
