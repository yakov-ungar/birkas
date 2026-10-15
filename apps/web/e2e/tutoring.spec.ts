import { expect, test } from '@playwright/test';
import { OFFICE, signIn } from './helpers';

const used = new Set<string>();

// This spec moves the server clock to the end of the month; put it back for any later spec.
test.afterAll(async ({ request }) => {
  await request.post('/api/test/clock/reset');
});

test('private lessons: add an אברך and a lesson, charged at month end, itemized on the receipt', async ({
  page,
  request,
}) => {
  await signIn(page, OFFICE, used);

  // Settings → private lessons: a new אברך.
  await page.getByRole('link', { name: 'הגדרות וחיבורים' }).click();
  await page.getByRole('tab', { name: 'שיעורים פרטיים' }).click();
  await expect(page.getByLabel('רשימת המקצועות, מופרדים בפסיק')).toHaveValue(/גמרא, משנה/);
  await page.getByRole('button', { name: 'אברך חדש' }).click();
  const t = page.getByRole('dialog', { name: 'אברך חדש' });
  await t.getByLabel('שם האברך').fill('הרב אהרן גולד');
  await t.getByRole('button', { name: 'שמירה' }).click();
  await expect(page.getByRole('row', { name: /הרב אהרן גולד/ })).toContainText('פעיל');

  // A student, and a lesson in the student card.
  await page.getByRole('link', { name: 'תלמידים ומשפחות' }).click();
  await page.getByRole('button', { name: 'תלמיד חדש' }).click();
  const d = page.getByRole('dialog', { name: 'תלמיד חדש' });
  await d.getByLabel('שם התלמיד המלא').fill('שמואל פרידמן');
  await d.getByLabel('כיתה').selectOption("ג'");
  await d.getByLabel('שם ההורה').fill('אליהו פרידמן');
  await d.getByLabel('טלפון').fill('055-1212121');
  await d.getByRole('button', { name: 'שמירה' }).click();
  await page.getByRole('dialog', { name: 'התלמיד נוסף' }).getByRole('button', { name: 'סגור' }).click();
  await page.getByRole('button', { name: 'כרטיס תלמיד שמואל פרידמן' }).click();
  await page.getByRole('button', { name: 'הוספת שיעור פרטי' }).click();
  const l = page.getByRole('dialog', { name: 'הוספת שיעור פרטי' });
  await l.getByLabel('אברך').selectOption({ label: 'הרב אהרן גולד' });
  await l.getByLabel('מקצוע').selectOption('משנה');
  await l.getByLabel('מחיר לחודש (₪)').fill('450');
  await l.getByRole('button', { name: 'הוספה' }).click();
  const card = page.getByRole('dialog', { name: /שמואל פרידמן/ });
  await expect(card).toContainText('משנה · הרב אהרן גולד');
  await expect(card).toContainText('₪450');
  await page.keyboard.press('Escape');

  // The end of the month: the nightly run charges the lesson.
  const now = new Date();
  const todayIl = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Jerusalem' });
  const [y, m] = todayIl.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const target = new Date(`${todayIl.slice(0, 8)}${String(last).padStart(2, '0')}T03:00:00+03:00`);
  const minutes = Math.max(1, Math.ceil((target.getTime() - now.getTime()) / 60_000));
  await page.request.post('/api/test/clock/advance', { data: { minutes } });
  await request.post('/api/test/scheduler/tick');

  await page.reload();
  await page.getByRole('link', { name: 'תלמידים ומשפחות' }).click();
  await page.getByRole('button', { name: 'כרטיס תלמיד שמואל פרידמן' }).click();
  const month = `${String(m).padStart(2, '0')}/${y}`;
  await expect(page.getByRole('dialog', { name: /שמואל פרידמן/ })).toContainText(
    `שיעור פרטי: משנה · הרב אהרן גולד · ${month}`,
  );

  // A payment of tuition + lesson: the receipt lists the lesson as its own item.
  await page.getByRole('dialog').getByRole('button', { name: 'קבלת תשלום' }).click();
  const pay = page.getByRole('dialog', { name: 'קבלת תשלום' });
  await pay.getByLabel('סכום (₪)').fill('10,050');
  await pay.getByLabel('אמצעי תשלום').selectOption('transfer');
  await pay.getByRole('button', { name: 'המשך' }).click();
  const det = page.getByRole('dialog', { name: /העברה/ });
  await det.getByLabel('בנק מעביר').fill('מזרחי');
  await det.getByLabel('אסמכתא').fill('7788');
  await det.getByRole('button', { name: 'אישור ורישום' }).click();
  await page
    .getByRole('dialog', { name: 'התשלום התקבל' })
    .getByRole('button', { name: 'צפייה והדפסה' })
    .click();
  const receipt = page.getByRole('dialog', { name: /קבלה מס׳/ });
  await expect(receipt).toContainText('· שכר לימוד');
  await expect(receipt).toContainText(`· שיעור פרטי: משנה · הרב אהרן גולד · ${month}`);
  await expect(receipt.getByRole('row', { name: /שיעור פרטי/ })).toContainText('₪450');
});
