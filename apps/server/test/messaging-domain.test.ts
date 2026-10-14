import { describe, expect, it } from 'vitest';
import { isQuiet, nextAllowed } from '../src/domain/quiet-hours';
import { fillTemplate } from '../src/domain/templates';

// Israel is UTC+3 in summer (IDT) and UTC+2 in winter (IST).
const il = (s: string, offset = '+03:00') => new Date(`${s}${offset}`);

describe('templates', () => {
  it('fills known placeholders and leaves unknown or missing ones', () => {
    expect(fillTemplate('שלום {הורה}, יתרה {יתרה} {לא_קיים} {סיבה}', { הורה: 'דוד', יתרה: '₪10' })).toBe(
      'שלום דוד, יתרה ₪10 {לא_קיים} {סיבה}',
    );
  });
});

describe('quiet hours', () => {
  it('allows 08:00-21:00 on a regular weekday', () => {
    expect(isQuiet(il('2026-10-14T07:59:00'))).toBe(true);
    expect(isQuiet(il('2026-10-14T08:00:00'))).toBe(false);
    expect(isQuiet(il('2026-10-14T20:59:00'))).toBe(false);
    expect(isQuiet(il('2026-10-14T21:00:00'))).toBe(true);
  });

  it('blocks Shabbat and Friday afternoon', () => {
    expect(isQuiet(il('2026-10-16T12:00:00'))).toBe(false); // Friday morning
    expect(isQuiet(il('2026-10-16T14:30:00'))).toBe(true); // Friday afternoon
    expect(isQuiet(il('2026-10-17T12:00:00'))).toBe(true); // Saturday
  });

  it('blocks festivals and their eves (from the Hebrew calendar)', () => {
    expect(isQuiet(il('2026-09-21T12:00:00'))).toBe(true); // Yom Kippur 5787
    expect(isQuiet(il('2026-09-20T15:00:00'))).toBe(true); // its eve, afternoon
    expect(isQuiet(il('2026-09-20T10:00:00'))).toBe(false); // its eve, morning
    expect(isQuiet(il('2027-04-22T12:00:00'))).toBe(true); // Pesach 5787
  });

  it('moves a 02:00 nightly message to 08:00, and a Friday-afternoon one to Sunday 08:00', () => {
    expect(nextAllowed(il('2026-10-14T02:00:00')).toISOString()).toBe(
      il('2026-10-14T08:00:00').toISOString(),
    );
    expect(nextAllowed(il('2026-10-16T15:10:00')).toISOString()).toBe(
      il('2026-10-18T08:00:00').toISOString(),
    );
    const ok = il('2026-10-14T10:07:00');
    expect(nextAllowed(ok)).toBe(ok);
  });
});
