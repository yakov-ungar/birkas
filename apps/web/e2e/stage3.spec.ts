import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { OFFICE, signIn } from './helpers';

const used = new Set<string>();

// This spec moves the server's test clock; put it back so later specs (and their 2FA codes) use real time.
test.afterAll(async ({ request }) => {
  await request.post('/api/test/clock/reset');
});
const PAN = '5326100000000004';

test('stage 3: save a card, create a plan, run it, advance a month and run again', async ({
  page,
  request,
}) => {
  // Every API response is checked for the card number as well.
  const leaks: string[] = [];
  page.on('response', async (r) => {
    if (!r.url().includes('/api/')) return;
    const body = await r.text().catch(() => '');
    if (body.includes(PAN)) leaks.push(r.url());
  });

  await signIn(page, OFFICE, used);
  await page.getByRole('link', { name: 'תלמידים ומשפחות' }).click();
  await page.getByRole('button', { name: 'תלמיד חדש' }).click();
  const d = page.getByRole('dialog', { name: 'תלמיד חדש' });
  await d.getByLabel('שם התלמיד המלא').fill('שמואל גולד');
  await d.getByLabel('כיתה').selectOption("ד'");
  await d.getByLabel('שם ההורה').fill('יעקב גולד');
  await d.getByLabel('טלפון').fill('050-4444444');
  await d.getByRole('button', { name: 'שמירה' }).click();
  await page.getByRole('button', { name: 'פתיחת כרטיס תלמיד' }).click();

  // Add a saved card from the student card.
  await page.getByRole('dialog').getByRole('button', { name: 'הוספת כרטיס' }).click();
  const add = page.getByRole('dialog', { name: 'הוספת כרטיס שמור' });
  const f = add.frameLocator('iframe[title^="שדות כרטיס"]');
  await f.getByLabel('שם בעל הכרטיס').fill('יעקב גולד');
  await f.getByLabel('ת״ז בעל הכרטיס').fill('123456782');
  await f.getByLabel('מספר כרטיס').fill(PAN);
  await f.getByLabel('תוקף (MM/YY)').fill('11/31');
  await f.getByLabel('CVV').fill('321');
  await add.getByRole('button', { name: 'שמירה' }).click();
  await page
    .getByRole('dialog', { name: 'הכרטיס נשמר' })
    .getByRole('button', { name: 'חזרה לכרטיס התלמיד' })
    .click();
  await expect(page.getByRole('dialog', { name: /שמואל גולד/ })).toContainText('****0004');

  // Billing plan: 3 installments of ₪1,000 by card, with the payer's consent.
  await page.getByRole('dialog').getByRole('button', { name: 'תוכנית חיוב' }).click();
  const np = page.getByRole('dialog', { name: 'תוכנית חיוב חדשה' });
  await np.getByLabel('סכום כולל (₪)').fill('3000');
  await np.getByLabel(/מספר תשלומים/).fill('3');
  await expect(np.getByLabel('כרטיס')).toHaveValue(/.+/);
  await np.getByRole('button', { name: 'המשך' }).click();
  const confirm = page.getByRole('dialog', { name: 'אישור תוכנית חיוב' });
  await expect(confirm.getByRole('row')).toHaveCount(4);
  await expect(confirm).toContainText('יעקב גולד אישר/ה חיוב כרטיס אשראי');
  await expect(confirm.getByRole('button', { name: 'אישור ויצירה' })).toBeDisabled();
  await confirm.getByLabel(/אני מאשר\/ת שההורה הסכים/).check();
  await confirm.getByRole('button', { name: 'אישור ויצירה' }).click();
  await expect(page.getByRole('dialog')).toContainText('התוכנית נוצרה');
  await page.keyboard.press('Escape');

  // Alerts show the due charge.
  await expect(page.getByRole('button', { name: /^התראות \(\d+\)$/ })).toBeVisible();

  await page.getByRole('link', { name: 'תוכניות חיוב' }).click();
  await expect(page.getByText('חיובים שהגיע מועדם: 1')).toBeVisible();
  await page.getByRole('button', { name: 'הרץ חיובים שהגיע מועדם' }).click();
  const sum = page.getByRole('dialog', { name: 'סיכום חיובים' });
  await expect(sum).toContainText('הצליחו: 1');
  await expect(sum).toContainText('נכשלו: 0');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'תוכנית של שמואל גולד' })).toContainText('1 מתוך 3');

  // Advance the test clock a month: the second installment becomes due.
  await page.getByRole('button', { name: 'קדם חודש (בדיקה)' }).click();
  await expect(page.getByText('חיובים שהגיע מועדם: 1')).toBeVisible();
  await page.getByRole('button', { name: 'הרץ חיובים שהגיע מועדם' }).click();
  await expect(page.getByRole('dialog', { name: 'סיכום חיובים' })).toContainText('הצליחו: 1');
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'תוכנית של שמואל גולד' }).click();
  const plan = page.getByRole('dialog', { name: /שמואל גולד · פריסה ל-3 תשלומים/ });
  await expect(plan.getByText('שולם', { exact: true })).toHaveCount(2);
  await expect(plan.getByRole('button', { name: 'קבלה' })).toHaveCount(2);
  await page.keyboard.press('Escape');

  // Dashboard renders KPIs and the charts with a table view.
  await page.getByRole('link', { name: 'לוח בקרה' }).click();
  await expect(page.getByText('תוכניות חיוב פעילות')).toBeVisible();
  await expect(page.getByText('גבייה בפועל בחצי השנה האחרונה')).toBeVisible();
  const a11y = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(a11y.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);

  // The card number never reached the server: not in any table, log line or response.
  const scan = await (await request.get(`/api/test/scan?needle=${PAN}`)).json();
  expect(scan).toEqual({ hits: [], logsScanned: true });
  const cvvScan = await (await request.get(`/api/test/scan?needle=${'1000000000'}`)).json();
  expect(cvvScan.hits).toEqual([]);
  expect(leaks).toEqual([]);
});
