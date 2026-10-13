import argon2 from 'argon2';

/** OWASP-recommended argon2id parameters, sized for a 1GB server. */
const OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (pw: string) => argon2.hash(pw, OPTIONS);

let dummyHash: Promise<string> | null = null;

/** Verifies; for unknown users it still burns the same time to avoid user enumeration by timing. */
export async function verifyPassword(hash: string | null | undefined, pw: string): Promise<boolean> {
  if (!hash) {
    dummyHash ??= argon2.hash('dummy-password-for-timing', OPTIONS);
    await argon2.verify(await dummyHash, pw).catch(() => false);
    return false;
  }
  return argon2.verify(hash, pw).catch(() => false);
}

export function passwordProblem(pw: string, minLength: number, email: string): string | null {
  if (pw.length < minLength) return `הסיסמה חייבת לכלול לפחות ${minLength} תווים`;
  if (pw.length > 128) return 'הסיסמה ארוכה מדי';
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  if (local.length >= 4 && pw.toLowerCase().includes(local)) return 'הסיסמה לא יכולה לכלול את כתובת האימייל';
  if (new Set(pw).size < 4) return 'הסיסמה פשוטה מדי';
  return null;
}
