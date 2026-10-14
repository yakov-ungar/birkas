import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { OFFICE, signIn } from './helpers';

const used = new Set<string>();
const inDays = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });

test('stage 5: payment promise, debtors, rule check and a group SMS', async ({ page }) => {
  await signIn(page, OFFICE, used);
  await page.getByRole('link', { name: 'תלמידים ומשפחות' }).click();
  await page.getByRole('button', { name: 'תלמיד חדש' }).click();
  const d = page.getByRole('dialog', { name: 'תלמיד חדש' });
  await d.getByLabel('שם התלמיד המלא').fill('אליהו רוזן');
  await d.getByLabel('כיתה').selectOption("א'");
  await d.getByLabel('שם ההורה').fill('נחמן רוזן');
  await d.getByLabel('טלפון').fill('053-5555555');
  await d.getByRole('button', { name: 'שמירה' }).click();
  await page.getByRole('dialog', { name: 'התלמיד נוסף' }).getByRole('button', { name: 'סגור' }).click();

  // A payment promise from the family card.
  await page.getByRole('tab', { name: 'משפחות' }).click();
  await page.getByRole('button', { name: 'כרטיס משפחת רוזן' }).click();
  await page.getByRole('dialog', { name: 'משפחת רוזן' }).getByRole('button', { name: 'הערת גבייה' }).click();
  const note = page.getByRole('dialog', { name: 'הערת גבייה - משפחת רוזן' });
  await note.getByLabel('סוג').selectOption('promise');
  await note.getByLabel('הערה').fill('ישלם אחרי החג');
  await note.getByLabel('תאריך הבטחה').fill(inDays(5));
  await note.getByLabel('סכום מובטח (₪)').fill('2000');
  await note.getByRole('button', { name: 'שמירה' }).click();
  const fam = page.getByRole('dialog', { name: 'משפחת רוזן' });
  await expect(fam).toContainText('הבטחת תשלום: ₪2,000');
  await expect(fam).toContainText('ישלם אחרי החג');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'כרטיס משפחת רוזן' })).toContainText('₪2,000');

  // Debtors list shows it, with the last contact.
  await page.getByRole('link', { name: 'גבייה והודעות' }).click();
  const row = page.getByRole('row', { name: /משפחת רוזן/ });
  await expect(row).toContainText('₪2,000');
  await expect(row).toContainText('(0 ימים)');

  // Rule check: "would send N messages now" without sending.
  await page.getByRole('tab', { name: 'תזכורות אוטומטיות' }).click();
  await page.getByRole('button', { name: 'בדיקת חוב מעל 30 יום' }).click();
  await expect(page.getByRole('dialog', { name: 'בדיקת כלל: חוב מעל 30 יום' })).toContainText(
    /הכלל היה שולח כעת \d+ הודעות במייל/,
  );
  await page.keyboard.press('Escape');

  // Group SMS to all debtors.
  await page.getByRole('tab', { name: 'מעקב חייבים' }).click();
  await page.getByRole('button', { name: 'שליחת הודעה לקבוצה' }).click();
  const g = page.getByRole('dialog', { name: 'שליחת הודעה לקבוצה' });
  await g.getByLabel('ערוץ').selectOption('sms');
  await g.getByRole('button', { name: 'המשך' }).click();
  const confirm = page.getByRole('dialog', { name: 'אישור שליחה' });
  await expect(confirm).toContainText(/לשלוח \d+ הודעות בSMS\?/);
  await expect(confirm).toContainText('נשארה יתרה לתשלום שכר לימוד בסך');
  await confirm.getByRole('button', { name: 'שליחה' }).click();
  await expect(page.getByRole('dialog', { name: 'ההודעות נשלחו' })).toContainText('הודעות נמסרו');
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'היסטוריית הודעות' }).click();
  await expect(page.getByRole('row', { name: /SMS/ }).first()).toContainText('ידני');

  const a11y = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(a11y.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
});
