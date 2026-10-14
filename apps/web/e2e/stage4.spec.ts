import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { OFFICE, signIn } from './helpers';

const used = new Set<string>();
const todayIl = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });

test('stage 4: cash drawer, returned check with fee, and bank import matching', async ({ page }) => {
  await signIn(page, OFFICE, used);

  // A new family for this flow.
  await page.getByRole('link', { name: 'תלמידים ומשפחות' }).click();
  await page.getByRole('button', { name: 'תלמיד חדש' }).click();
  const d = page.getByRole('dialog', { name: 'תלמיד חדש' });
  await d.getByLabel('שם התלמיד המלא').fill('אברהם לוי');
  await d.getByLabel('כיתה').selectOption("ה'");
  await d.getByLabel('שם ההורה').fill('משה לוי');
  await d.getByLabel('טלפון').fill('052-2222222');
  await d.getByRole('button', { name: 'שמירה' }).click();
  await page.getByRole('dialog', { name: 'התלמיד נוסף' }).getByRole('button', { name: 'סגור' }).click();

  // Cash needs an open drawer.
  await page.getByRole('link', { name: 'שיקים וקופה' }).click();
  await page.getByRole('tab', { name: 'קופה מזומן' }).click();
  await page.getByRole('button', { name: 'פתיחת קופה' }).click();
  await page
    .getByRole('dialog', { name: 'פתיחת קופה' })
    .getByLabel(/יתרת פתיחה/)
    .fill('100');
  await page.getByRole('dialog', { name: 'פתיחת קופה' }).getByRole('button', { name: 'פתיחה' }).click();
  await expect(page.getByText('צפוי בקופה')).toBeVisible();

  // ₪500 cash for Avraham.
  await page.getByRole('link', { name: 'קבלות וזיכויים' }).click();
  await page.getByRole('button', { name: 'קבלת תשלום והפקת קבלה' }).click();
  const pay = page.getByRole('dialog', { name: 'קבלת תשלום' });
  await pay.getByLabel('עבור').selectOption({ label: 'אברהם לוי (יתרה ₪9,600)' });
  await pay.getByLabel('סכום (₪)').fill('500');
  await pay.getByLabel('אמצעי תשלום').selectOption('cash');
  await pay.getByRole('button', { name: 'המשך' }).click();
  await page
    .getByRole('dialog', { name: /מזומן - אברהם לוי/ })
    .getByRole('button', { name: 'אישור ורישום' })
    .click();
  await expect(page.getByRole('dialog', { name: 'התשלום התקבל' })).toBeVisible();
  await page.keyboard.press('Escape');

  // Check: register, deposit, then it bounces.
  await page.getByRole('link', { name: 'שיקים וקופה' }).click();
  await page.getByRole('button', { name: 'רישום שיק' }).click();
  const chk = page.getByRole('dialog', { name: 'רישום שיק' });
  await chk.getByLabel('תלמיד').selectOption({ label: 'אברהם לוי' });
  await chk.getByLabel('מספר שיק').fill('778812');
  await chk.getByLabel('בנק וסניף').fill('לאומי 905');
  await chk.getByLabel('סכום (₪)').fill('1000');
  await chk.getByLabel('תאריך פירעון').fill(todayIl());
  await chk.getByRole('button', { name: 'רישום' }).click();
  const row = page.getByRole('row', { name: /778812/ });
  await expect(row).toContainText('הגיע מועד');
  await row.getByRole('button', { name: 'הפקדה' }).click();
  await expect(row).toContainText('הופקד');
  await row.getByRole('button', { name: 'סמן כחוזר' }).click();
  await page
    .getByRole('dialog', { name: 'שיק 778812 חזר' })
    .getByRole('button', { name: 'סמן כחוזר' })
    .click();
  await expect(row).toContainText('חזר');

  // Balance: 9,600 - 500 cash, check reversed, + ₪30 fee = 9,130.
  await page.getByRole('link', { name: 'תלמידים ומשפחות' }).click();
  await expect(page.getByRole('button', { name: 'כרטיס תלמיד אברהם לוי' })).toContainText('₪9,130');
  await page.getByRole('button', { name: 'כרטיס תלמיד אברהם לוי' }).click();
  const card = page.getByRole('dialog', { name: /אברהם לוי/ });
  await expect(card.getByRole('cell', { name: 'עמלת שיק חוזר 778812' })).toBeVisible();
  await expect(
    card.getByRole('cell', { name: /ביטול תשלום שיק · שיק חוזר 778812 \(אישור זיכוי \d+\)/ }),
  ).toBeVisible();
  await page.keyboard.press('Escape');

  // Close the drawer with a ₪10 shortfall: expected 600 (100 float + 500).
  await page.getByRole('link', { name: 'שיקים וקופה' }).click();
  await page.getByRole('tab', { name: 'קופה מזומן' }).click();
  await page.getByRole('button', { name: 'סגירת קופה' }).click();
  const close = page.getByRole('dialog', { name: 'סגירת קופה' });
  await expect(close.getByLabel(/צפוי: ₪600/)).toHaveValue('600');
  await close.getByLabel(/סכום שנספר/).fill('590');
  await close.getByRole('button', { name: 'סגירה' }).click();
  const diff = page.getByRole('dialog', { name: 'יש הפרש בקופה' });
  await expect(diff).toContainText('הפרש של');
  await diff.getByRole('button', { name: 'סגירה' }).click();
  await expect(page.getByRole('dialog', { name: 'הקופה נסגרה' })).toContainText('נספר ₪590');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'פתיחת קופה' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '-₪10' })).toBeVisible();

  // Bank statement: a transfer from the parent is matched by name.
  await page.getByRole('link', { name: 'בנק והוראות קבע' }).click();
  await page.getByRole('button', { name: 'ייבוא דף בנק' }).click();
  const imp = page.getByRole('dialog', { name: 'ייבוא דף בנק' });
  const csv =
    '﻿' +
    [
      'תאריך,תיאור התנועה,אסמכתא,חובה,זכות',
      `${todayIl().split('-').reverse().join('/')},העברה ממשה לוי,4455,,"1,500.00"`,
      '01/10/2026,עמלה,,12.00,',
    ].join('\r\n');
  await imp
    .getByLabel('קובץ')
    .setInputFiles({ name: 'bank.csv', mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await imp.getByRole('button', { name: 'ייבוא' }).click();
  await expect(page.getByRole('dialog', { name: 'הייבוא הסתיים' })).toContainText(
    'נקלטו 1 זיכויים, מתוכם 1 זוהו',
  );
  await page.keyboard.press('Escape');
  const t = page.getByRole('row', { name: /העברה ממשה לוי/ });
  await expect(t).toContainText('משפחת לוי');
  await t.getByRole('button', { name: 'אישור' }).click();
  await expect(t).toContainText('נרשם');

  const a11y = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(a11y.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
});
