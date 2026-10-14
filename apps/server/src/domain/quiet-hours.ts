/**
 * When automatic SMS / WhatsApp may go out (decision C14): 08:00-21:00 Israel time,
 * not on Shabbat or a festival (Israel), and not from 14:00 on Friday or a festival eve.
 */
const parts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Jerusalem',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const hebrew = new Intl.DateTimeFormat('en-u-ca-hebrew', {
  timeZone: 'Asia/Jerusalem',
  day: 'numeric',
  month: 'long',
});

/** Festival days (yom tov) in Israel, by Hebrew date. */
const FESTIVALS = new Set([
  '1 Tishri',
  '2 Tishri',
  '10 Tishri',
  '15 Tishri',
  '22 Tishri',
  '15 Nisan',
  '21 Nisan',
  '6 Sivan',
]);

export const isFestival = (d: Date) => FESTIVALS.has(hebrew.format(d));

export function isQuiet(d: Date): boolean {
  const p = Object.fromEntries(parts.formatToParts(d).map((x) => [x.type, x.value]));
  const hour = Number(p.hour);
  if (hour < 8 || hour >= 21) return true;
  if (p.weekday === 'Sat' || isFestival(d)) return true;
  const tomorrow = new Date(d.getTime() + 86_400_000);
  if (hour >= 14 && (p.weekday === 'Fri' || isFestival(tomorrow))) return true;
  return false;
}

/** The first moment at or after `d` when sending is allowed (15-minute steps). */
export function nextAllowed(d: Date): Date {
  let t = d;
  for (let i = 0; i < 4 * 24 * 8 && isQuiet(t); i++)
    t = new Date(Math.floor(t.getTime() / 900_000) * 900_000 + 900_000);
  return t;
}
