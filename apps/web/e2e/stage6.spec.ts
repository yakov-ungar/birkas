import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { OFFICE, signIn } from './helpers';

const used = new Set<string>();
const PHONE = '054-6666666';

const noSerious = async (page: import('@playwright/test').Page) => {
  const a11y = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(a11y.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
};

test('stage 6: a parent asks for installments in the portal, staff approve, the plan is created', async ({
  page,
  browser,
  request,
}) => {
  // Staff: a family with a balance.
  await signIn(page, OFFICE, used);
  await page.getByRole('link', { name: 'תלמידים ומשפחות' }).click();
  await page.getByRole('button', { name: 'תלמיד חדש' }).click();
  const d = page.getByRole('dialog', { name: 'תלמיד חדש' });
  await d.getByLabel('שם התלמיד המלא').fill('נועה ברק');
  await d.getByLabel('כיתה').selectOption("ב'");
  await d.getByLabel('שם ההורה').fill('יעל ברק');
  await d.getByLabel('טלפון').fill(PHONE);
  await d.getByRole('button', { name: 'שמירה' }).click();
  await page.getByRole('dialog', { name: 'התלמיד נוסף' }).getByRole('button', { name: 'סגור' }).click();

  // Parent: a separate browser context, so no staff cookie is around.
  const parentCtx = await browser.newContext({ locale: 'he-IL', timezoneId: 'Asia/Jerusalem' });
  const portal = await parentCtx.newPage();
  await portal.goto('/portal');
  await portal.getByLabel('טלפון או מייל הרשומים בבית הספר').fill(PHONE);
  await portal.getByRole('button', { name: 'שליחת קוד' }).click();
  await expect(portal.getByText('אם הפרטים רשומים אצלנו, נשלח אליהם קוד בן 6 ספרות.')).toBeVisible();
  const texts = (await (await request.get('/api/test/texts?to=0546666666')).json()) as {
    texts: { body: string }[];
  };
  const code = texts.texts[0]!.body.match(/\d{6}/)![0];
  await portal.getByLabel('קוד כניסה').fill(code);
  await portal.getByRole('button', { name: 'כניסה' }).click();
  await expect(portal.getByText('שלום יעל ברק')).toBeVisible();
  await expect(portal.getByText('יתרה לתשלום')).toBeVisible();
  await noSerious(portal);

  await portal.getByRole('button', { name: 'בקשת פריסה' }).click();
  const req = portal.getByRole('dialog', { name: 'בקשת פריסה' });
  await req.getByLabel('מספר חודשים').selectOption('6');
  await req.getByLabel('אמצעי חיוב מועדף').selectOption('transfer');
  await req.getByLabel('הערה לבית הספר').fill('נבקש לפרוס את היתרה');
  await req.getByRole('button', { name: 'שליחה' }).click();
  await expect(portal.getByRole('dialog', { name: 'הבקשה נשלחה' })).toContainText('בית הספר יחזור אליך');
  await portal.getByRole('button', { name: 'סגירה' }).click();
  await expect(portal.getByText('6 חודשים · העברה')).toBeVisible();
  await expect(portal.locator('.pill', { hasText: 'ממתין' })).toBeVisible();

  // Staff: the alert, the request and its approval.
  await page.getByRole('link', { name: 'לוח בקרה' }).click();
  await expect(page.getByText(/בקשות הורים ממתינות לטיפול/)).toBeVisible();
  await page.getByRole('link', { name: 'בקשות הורים' }).click();
  const row = page.getByRole('row', { name: /משפחת ברק/ });
  await expect(row).toContainText('6 חודשים · העברה');
  await expect(row).toContainText('נבקש לפרוס את היתרה');
  await row.getByRole('button', { name: 'אישור' }).click();
  const ap = page.getByRole('dialog', { name: 'אישור בקשת פריסה - משפחת ברק' });
  await expect(ap).toContainText('נועה ברק');
  await noSerious(page);
  await ap.getByRole('button', { name: 'יצירת תוכניות ואישור' }).click();
  await expect(row.locator('.pill')).toHaveText('אושרה');

  await page.getByRole('link', { name: 'תוכניות חיוב' }).click();
  const plan = page.getByRole('button', { name: 'תוכנית של נועה ברק' });
  await expect(plan).toContainText('פריסה ל-6 תשלומים');
  await expect(plan).toContainText('העברה');

  // The parent sees the decision.
  await portal.reload();
  await expect(portal.locator('.pill', { hasText: 'אושרה' })).toBeVisible();

  // Staff preview is read only (B8).
  await page.getByRole('link', { name: 'פורטל הורים (תצוגה)' }).click();
  await page.getByLabel('הצג כהורה').selectOption({ label: 'משפחת ברק - יעל ברק' });
  await expect(page.getByText('שלום יעל ברק')).toBeVisible();
  await expect(page.getByRole('button', { name: 'שלם עכשיו' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'בקשת הנחה' })).toBeDisabled();

  // Signing out ends the parent session.
  await portal.getByRole('button', { name: 'יציאה' }).click();
  await expect(portal.getByRole('button', { name: 'שליחת קוד' })).toBeVisible();
  await parentCtx.close();
});
