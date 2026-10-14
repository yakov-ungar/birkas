import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { OFFICE, signIn } from './helpers';

const used = new Set<string>();
const PAN = '4580 0000 0000 0000'.replace(/ /g, '');

async function addStudent(page: Page, name: string, family: string | null, grade: string) {
  await page.getByRole('button', { name: 'תלמיד חדש' }).click();
  const d = page.getByRole('dialog', { name: 'תלמיד חדש' });
  if (family) await d.getByLabel('משפחה').selectOption({ label: family });
  await d.getByLabel('שם התלמיד המלא').fill(name);
  await d.getByLabel('כיתה').selectOption(grade);
  if (!family) {
    await d.getByLabel('שם ההורה').fill('דוד כהן');
    await d.getByLabel('טלפון').fill('050-1111111');
  }
  await d.getByRole('button', { name: 'שמירה' }).click();
  await expect(page.getByRole('dialog', { name: 'התלמיד נוסף' })).toBeVisible();
  await page.getByRole('button', { name: 'סגור' }).click();
}

test('stage 2: family payment by card with automatic split, receipt and cancellation', async ({
  page,
  request,
}) => {
  await signIn(page, OFFICE, used);
  await page.getByRole('link', { name: 'תלמידים ומשפחות' }).click();

  await addStudent(page, 'יוסף כהן', null, "ג'");
  await addStudent(page, 'אפרים כהן', 'משפחת כהן - דוד כהן', "א'");

  // Sibling discount applied to the second child: 9,600 - 960.
  const ephraim = page.getByRole('button', { name: 'כרטיס תלמיד אפרים כהן' });
  await expect(ephraim).toContainText('₪8,640');

  // Pay ₪10,000 for the whole family by a new card typed in the provider's hosted fields.
  await page.getByRole('tab', { name: 'משפחות' }).click();
  await page.getByRole('button', { name: 'כרטיס משפחת כהן' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'תשלום למשפחה' }).click();
  const pay = page.getByRole('dialog', { name: 'קבלת תשלום' });
  await pay.getByLabel('סכום (₪)').fill('10,000');
  await pay.getByLabel('אמצעי תשלום').selectOption('card');
  await pay.getByRole('button', { name: 'המשך' }).click();

  const details = page.getByRole('dialog', { name: /אשראי - כל משפחת כהן/ });
  const fields = details.frameLocator('iframe[title^="שדות כרטיס"]');
  await fields.getByLabel('שם בעל הכרטיס').fill('דוד כהן');
  await fields.getByLabel('ת״ז בעל הכרטיס').fill('123456782');
  await fields.getByLabel('מספר כרטיס').fill(PAN);
  await fields.getByLabel('תוקף (MM/YY)').fill('12/30');
  await fields.getByLabel('CVV').fill('123');
  await details.getByLabel(/לשמור את הכרטיס/).check();

  // Automatic split: the larger debt (Yosef 9,600) first, remainder to Ephraim.
  await expect(details.getByLabel('סכום ליוסף כהן')).toHaveValue('9600');
  await expect(details.getByLabel('סכום לאפרים כהן')).toHaveValue('400');
  await details.getByRole('button', { name: 'חיוב' }).click();

  const done = page.getByRole('dialog', { name: 'התשלום התקבל' });
  await expect(done).toContainText('קבלה מס׳ 3001 הופקה');
  await expect(done).toContainText(/מספר אישור: \d{6}/);
  await done.getByRole('button', { name: 'צפייה והדפסה' }).click();
  const receipt = page.getByRole('dialog', { name: /קבלה מס׳ 3001/ });
  await expect(receipt.getByRole('cell', { name: 'יוסף כהן' })).toBeVisible();
  await expect(receipt.getByRole('cell', { name: '₪9,600' })).toBeVisible();
  await expect(receipt).toContainText('כרטיס ****0000');

  // The card number never reached the server: not in the database, only a token was saved.
  const scan = await request.get(`/api/test/scan?needle=${PAN}`);
  expect((await scan.json()).hits).toEqual([]);

  // Cancel the receipt: a credit note with its own numbering, balances back to the start.
  await receipt.getByRole('button', { name: 'ביטול קבלה' }).click();
  await page
    .getByRole('dialog', { name: 'ביטול קבלה מס׳ 3001' })
    .getByLabel('סיבת הביטול')
    .fill('בקשת ההורה');
  await page
    .getByRole('dialog', { name: 'ביטול קבלה מס׳ 3001' })
    .getByRole('button', { name: 'ביטול קבלה' })
    .click();
  await expect(page.getByRole('dialog', { name: /אישור זיכוי מס׳ 1/ })).toContainText('זיכוי לקבלה מס׳ 3001');
  await page.keyboard.press('Escape');

  await page.getByRole('link', { name: 'קבלות וזיכויים' }).click();
  await expect(page.getByRole('row', { name: /^3001/ })).toContainText('מבוטלת');
  await expect(page.getByRole('row', { name: /^1 / })).toContainText('זיכוי');

  // Header search finds the receipt by number.
  await page.getByRole('searchbox', { name: 'חיפוש כללי' }).fill('3001');
  await page.getByRole('button', { name: 'חיפוש', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'תוצאות חיפוש: 3001' })).toContainText('קבלה 3001');
  await page.keyboard.press('Escape');

  await page.getByRole('link', { name: 'תלמידים ומשפחות' }).click();
  await expect(page.getByRole('button', { name: 'כרטיס תלמיד יוסף כהן' })).toContainText('חוב');
  const a11y = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(a11y.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
});

test('stage 2: charges screen, bulk charge and discount', async ({ page }) => {
  await signIn(page, OFFICE, used);
  await page.getByRole('link', { name: 'חיובים והנחות' }).click();
  await page.getByRole('button', { name: 'חיוב קבוצתי' }).click();
  const d = page.getByRole('dialog', { name: 'חיוב קבוצתי' });
  await d.getByLabel('פריט מהקטלוג').selectOption({ label: 'טיול שנתי (₪120)' });
  await d.getByRole('button', { name: 'המשך' }).click();
  const confirm = page.getByRole('dialog', { name: 'אישור חיוב קבוצתי' });
  await expect(confirm).toContainText('ייווצרו 2 חיובים בסך ₪240');
  await confirm.getByRole('button', { name: 'אישור וחיוב' }).click();
  await expect(page.getByRole('dialog', { name: 'החיובים נוצרו' })).toContainText('2 חיובים נוספו');
  await page.getByRole('button', { name: 'סגור' }).click();
  await expect(page.getByRole('cell', { name: 'טיול שנתי' }).first()).toBeVisible();

  await page.getByRole('button', { name: 'הנחה / מלגה' }).click();
  const disc = page.getByRole('dialog', { name: 'הנחה / מלגה' });
  await disc.getByLabel('תלמיד').selectOption({ label: "יוסף כהן (ג')" });
  await disc.getByLabel('אחוז').fill('15');
  await disc.getByRole('button', { name: 'אישור' }).click();
  await expect(page.getByRole('status')).toContainText('₪1,440 הופחתו מהיתרה');
});
