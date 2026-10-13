/**
 * Defense in depth against card data in logs: anything that looks like a card number
 * (13-19 digits, optionally separated by spaces/dashes, passing Luhn) is masked.
 */
const PAN_CANDIDATE = /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g;

export function luhnValid(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (dbl) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

export function maskPans(s: string): string {
  return s.replace(PAN_CANDIDATE, (m) => {
    const d = m.replace(/[ -]/g, '');
    return d.length >= 13 && d.length <= 19 && luhnValid(d) ? '[REDACTED-PAN]' : m;
  });
}

export function containsPan(s: string): boolean {
  return maskPans(s) !== s;
}

/** Keys whose values never reach a log line. */
export const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.code',
  '*.cvv',
  '*.cardNumber',
  '*.secret',
];
