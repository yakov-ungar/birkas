import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { authenticator } from 'otplib';

export const ADMIN = { email: 'admin@school.test', password: 'Admin-Pass-2026' };

/** Generates a code for the next 30s window so a code used moments ago is never replayed. */
export async function freshCode(secret: string, used: Set<string>) {
  for (;;) {
    const c = authenticator.generate(secret);
    if (!used.has(c)) {
      used.add(c);
      return c;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

export async function lastMailTo(request: APIRequestContext, to: string) {
  const r = await request.get(`/api/test/outbox?to=${encodeURIComponent(to)}`);
  expect(r.ok()).toBeTruthy();
  const { mails } = (await r.json()) as { mails: { subject: string; text: string }[] };
  expect(mails.length).toBeGreaterThan(0);
  return mails[0]!;
}

export async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel('אימייל').fill(email);
  await page.getByLabel('סיסמה').fill(password);
  await page.getByRole('button', { name: 'כניסה' }).click();
}

/** Completes forced 2FA enrollment and returns the secret. */
export async function enroll2fa(page: Page, used: Set<string>) {
  await expect(page.getByRole('heading', { name: 'הגדרת אימות דו-שלבי' })).toBeVisible();
  await expect(page.getByRole('img', { name: /קוד QR/ })).toBeVisible();
  await page.getByText('אי אפשר לסרוק? הזנה ידנית').click();
  const secret = (await page.getByTestId('totp-secret').textContent())!.trim();
  await page.getByLabel('קוד בן 6 ספרות').fill(await freshCode(secret, used));
  await page.getByRole('button', { name: 'אישור והפעלה' }).click();
  await expect(page.getByRole('heading', { name: 'האימות הדו-שלבי הוגדר' })).toBeVisible();
  await expect(page.getByLabel('קודי שחזור').locator('span')).toHaveCount(10);
  await page.getByRole('button', { name: 'שמרתי, המשך למערכת' }).click();
  return secret;
}
