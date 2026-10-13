import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { ADMIN, enroll2fa, freshCode, lastMailTo, login } from './helpers';

const used = new Set<string>();
let adminSecret = '';

test.describe.serial('stage 1: sign-in, 2FA, users and permissions', () => {
  test('wrong password shows a Hebrew error', async ({ page }) => {
    await login(page, ADMIN.email, 'wrong-password');
    await expect(page.getByRole('alert')).toHaveText('אימייל או סיסמה שגויים');
  });

  test('admin enrolls 2FA on first login and sees the full menu', async ({ page }) => {
    await login(page, ADMIN.email, ADMIN.password);
    adminSecret = await enroll2fa(page, used);
    const nav = page.getByRole('navigation', { name: 'תפריט ראשי' });
    await expect(nav.getByRole('link')).toHaveCount(14);
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByText('רחל (מנהלת)', { exact: false }).first()).toBeVisible();
  });

  test('admin signs in again with a TOTP code, creates a cashier and the cashier sees only her screens', async ({
    page,
    browser,
    request,
  }) => {
    await login(page, ADMIN.email, ADMIN.password);
    await expect(page.getByRole('heading', { name: 'אימות דו-שלבי' })).toBeVisible();
    await page.getByLabel(/קוד בן 6 ספרות/).fill(await freshCode(adminSecret, used));
    await page.getByRole('button', { name: 'אימות' }).click();

    await page.getByRole('link', { name: 'משתמשים והרשאות' }).click();
    await page.getByRole('button', { name: 'משתמש חדש' }).click();
    const dialog = page.getByRole('dialog', { name: 'משתמש חדש' });
    await dialog.getByLabel('שם').fill('קופאית');
    await dialog.getByLabel('אימייל').fill('cash@school.test');
    await dialog.getByLabel('תפקיד').selectOption('קופאית');
    await dialog.getByRole('button', { name: 'יצירה ושליחת הזמנה' }).click();
    await expect(page.getByRole('status')).toContainText('נשלחה הזמנה');
    const row = page.getByRole('button', { name: 'עריכת קופאית' });
    await expect(row).toContainText('ממתין להזמנה');
    await expect(row).toContainText('4 מתוך 14');
    await expect(page.getByText('נוצר משתמש: קופאית (קופאית)')).toBeVisible();

    // Invite link from the (mock) mailbox.
    const mail = await lastMailTo(request, 'cash@school.test');
    const link = /(http\S+#token=\S+)/.exec(mail.text)![1]!;
    const ctx = await browser.newContext({ locale: 'he-IL' });
    const p2 = await ctx.newPage();
    await p2.goto(link);
    await p2.getByLabel(/^סיסמה/).fill('Kupa-Secure-2026');
    await p2.getByLabel('אימות סיסמה').fill('Kupa-Secure-2026');
    await p2.getByRole('button', { name: 'שמירה' }).click();
    await expect(p2.getByRole('heading', { name: 'הסיסמה נשמרה' })).toBeVisible();

    await login(p2, 'cash@school.test', 'Kupa-Secure-2026');
    await enroll2fa(p2, used);
    const nav = p2.getByRole('navigation', { name: 'תפריט ראשי' });
    await expect(nav.getByRole('link')).toHaveText([
      'לוח בקרה',
      'תלמידים ומשפחות',
      'שיקים וקופה',
      'קבלות וזיכויים',
    ]);

    // Hidden in the UI and refused by the server.
    await p2.goto('/users');
    await expect(p2.getByRole('heading', { name: 'אין הרשאה' })).toBeVisible();
    const api = await p2.request.get('/api/users');
    expect(api.status()).toBe(403);
    await ctx.close();
  });

  test('admin cannot disable herself', async ({ page }) => {
    await login(page, ADMIN.email, ADMIN.password);
    await page.getByLabel(/קוד בן 6 ספרות/).fill(await freshCode(adminSecret, used));
    await page.getByRole('button', { name: 'אימות' }).click();
    await page.getByRole('link', { name: 'משתמשים והרשאות' }).click();
    await page.getByRole('button', { name: /עריכת רחל/ }).press('Enter');
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('משתמש פעיל').uncheck();
    await dialog.getByRole('button', { name: 'שמירה' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('אי אפשר להסיר מעצמך ניהול משתמשים או להשבית את עצמך');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    // Security settings and login events are visible to the admin.
    await page.getByRole('link', { name: 'הגדרות וחיבורים' }).click();
    await page.getByRole('tab', { name: 'אבטחה' }).click();
    await expect(page.getByText('אימות דו-שלבי חובה')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'ניסיון כושל' }).first()).toBeVisible();

    const a11y = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(a11y.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
  });
});
