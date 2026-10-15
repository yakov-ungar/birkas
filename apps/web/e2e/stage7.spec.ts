import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { OFFICE, signIn } from './helpers';

const used = new Set<string>();

test('stage 7: reports with CSV, general settings, a connection and opening a new year', async ({ page }) => {
  await signIn(page, OFFICE, used);
  await page.getByRole('link', { name: 'תלמידים ומשפחות' }).click();
  await page.getByRole('button', { name: 'תלמיד חדש' }).click();
  const d = page.getByRole('dialog', { name: 'תלמיד חדש' });
  await d.getByLabel('שם התלמיד המלא').fill('עומר שקד');
  await d.getByLabel('כיתה').selectOption("ג'");
  await d.getByLabel('שם ההורה').fill('אורי שקד');
  await d.getByLabel('טלפון').fill('054-7777777');
  await d.getByRole('button', { name: 'שמירה' }).click();
  await page.getByRole('dialog', { name: 'התלמיד נוסף' }).getByRole('button', { name: 'סגור' }).click();

  // Reports: the demo's buttons, a table with totals and an Excel-ready CSV.
  await page.getByRole('link', { name: 'דוחות' }).click();
  await page.getByRole('button', { name: 'חייבים וגיל חוב' }).click();
  const card = page.getByRole('main');
  await expect(card.locator('table')).toContainText('תלמידמשפחהשוטף31-6061-9090+יתרה');
  await expect(card.locator('table')).toContainText('עומר שקד');
  await page.getByRole('button', { name: 'תנועות לפי תקופה' }).click();
  await page.getByLabel('מתאריך').fill('2020-01-01');
  await expect(card.locator('thead')).toContainText('חובהזכות');
  await expect(card.locator('tfoot')).toContainText('סה״כ');
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'ייצוא לאקסל (CSV)' }).click(),
  ]);
  const csv = readFileSync((await dl.path())!, 'utf8');
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  expect(csv).toContain('"תאריך","תלמיד","משפחה","תיאור","חובה","זכות"');
  await page.getByRole('button', { name: 'לפי כיתה' }).click();
  await expect(page.getByLabel('שנת לימודים')).toHaveValue('תשפ״ז');
  const a11y = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(a11y.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);

  // General settings.
  await page.getByRole('link', { name: 'הגדרות וחיבורים' }).click();
  await page.getByRole('button', { name: 'עריכת הגדרות' }).click();
  const g = page.getByRole('dialog', { name: 'הגדרות כלליות' });
  await g.getByLabel('הנחת אחים - ילד שני (%)').fill('15');
  await expect(g).toContainText('יחשב מחדש את ההנחה לכל המשפחות');
  await g.getByRole('button', { name: 'שמירה' }).click();
  await expect(page.getByText('ההגדרות נשמרו וההנחות חושבו מחדש')).toBeVisible();
  await expect(page.getByRole('row', { name: /הנחת אחים/ })).toContainText('ילד שני 15%');

  // A connection: stored encrypted, test mode only.
  await page.getByRole('tab', { name: 'חיבורים' }).click();
  // Email only (stage 9): SMS is shown as not in use.
  await expect(page.getByRole('row', { name: /שירות SMS/ })).toContainText('לא בשימוש');
  const acc = page.getByRole('row', { name: /תוכנת הנהלת חשבונות/ });
  await expect(acc).toContainText('לא מחובר');
  await acc.getByRole('button', { name: 'הגדרה' }).click();
  const c = page.getByRole('dialog', { name: 'חיבור תוכנת הנהלת חשבונות' });
  await c.getByLabel('מפתח / שם משתמש').fill('school-acc');
  await c.getByLabel('סוד / סיסמה').fill('a-secret-value');
  await c.getByRole('button', { name: 'חיבור' }).click();
  await expect(page.getByRole('dialog', { name: 'החיבור הוגדר' })).toBeVisible();
  await page.getByRole('button', { name: 'סגירה' }).click();
  await expect(acc).toContainText('מחובר');
  await expect(acc).toContainText('מצב בדיקה');
  await page
    .getByRole('row', { name: /חברת סליקה/ })
    .getByRole('button', { name: 'בדיקת חיבור' })
    .click();
  await expect(page.getByRole('dialog', { name: 'החיבור תקין' })).toContainText('מצב בדיקה');
  await page.getByRole('button', { name: 'סגירה' }).click();

  // Opening a school year: preview first, then confirm.
  await page.getByRole('tab', { name: 'שנת לימודים' }).click();
  await expect(page.getByText('שנה פעילה: תשפ״ז')).toBeVisible();
  await page.getByRole('button', { name: 'פתיחת שנת לימודים חדשה' }).click();
  const y = page.getByRole('dialog', { name: 'פתיחת שנת לימודים חדשה' });
  await y.getByLabel('שם השנה').fill('תשפ״ח');
  await y.getByRole('button', { name: 'המשך' }).click();
  const ok = page.getByRole('dialog', { name: 'אישור פתיחת שנה' });
  await expect(ok).toContainText('תלמידים שיעלו כיתה');
  await expect(ok).toContainText('בתצוגה הזו עוד לא שונה דבר');
  await ok.getByRole('button', { name: 'אישור והפעלה' }).click();
  await expect(page.getByText(/השנה נפתחה: עלו כיתה \d+ תלמידים/)).toBeVisible();
  await expect(page.getByText('שנה פעילה: תשפ״ח')).toBeVisible();
  await page.getByRole('tab', { name: 'כללי' }).click();
  await expect(page.getByRole('row', { name: /שנת לימודים פעילה/ })).toContainText('תשפ״ח');
});
