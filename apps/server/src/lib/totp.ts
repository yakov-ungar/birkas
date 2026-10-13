import { authenticator } from 'otplib';
import QRCode from 'qrcode';

const STEP_SECONDS = 30;

export const newTotpSecret = () => authenticator.generateSecret(20);

/**
 * Accepts the current step and one step on each side (clock drift).
 * Returns the matched time step, or null. The caller stores it to block replays.
 */
export function checkTotp(secret: string, code: string, now: Date): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const step = Math.floor(now.getTime() / 1000 / STEP_SECONDS);
  for (const s of [step, step - 1, step + 1]) {
    const a = authenticator.clone({ epoch: s * STEP_SECONDS * 1000, step: STEP_SECONDS, window: 0 });
    if (a.check(code, secret)) return s;
  }
  return null;
}

export async function totpQr(secret: string, accountName: string, issuer: string) {
  const uri = authenticator.keyuri(accountName, issuer, secret);
  return { uri, qrDataUrl: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) };
}
