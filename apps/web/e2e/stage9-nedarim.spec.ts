import { expect, test } from '@playwright/test';
import { OFFICE, signIn } from './helpers';

const used = new Set<string>();

/**
 * Stands in for נדרים פלוס's iframe: answers GetHeight, and on FinishTransaction2 has "Nedarim's
 * server" call our callback, then reports success to the page, as the real iframe does.
 */
const FAKE_IFRAME = `<!doctype html><meta charset="utf-8"><body>
<label>מספר כרטיס <input name="card"></label>
<script>
addEventListener('message', async (e) => {
  const d = e.data || {};
  if (d.Name === 'GetHeight') parent.postMessage({ Name: 'Height', Value: 220 }, '*');
  if (d.Name === 'FinishTransaction2') {
    await window.nedarimCharge(d.Value);
    parent.postMessage({ Name: 'TransactionResponse', Value: { Status: 'OK', Message: '' } }, '*');
  }
});
</script></body>`;

test('card payment through the נדרים פלוס iframe, recorded by the server callback', async ({
  page,
  request,
}) => {
  const sent: Record<string, string>[] = [];
  await page.route('https://www.matara.pro/**', (route) =>
    route.fulfill({ contentType: 'text/html; charset=utf-8', body: FAKE_IFRAME }),
  );
  await page.exposeFunction('nedarimCharge', async (v: Record<string, string>) => {
    sent.push(v);
    const r = await request.post('/api/webhooks/nedarim', {
      headers: { 'content-type': 'text/plain' },
      data: JSON.stringify({
        Status: 'OK',
        Param1: v.Param1,
        Amount: v.Amount,
        TransactionId: '55001',
        Confirmation: '0777',
        LastNum: '4580',
      }),
    });
    expect(r.status()).toBe(200);
  });

  await signIn(page, OFFICE, used);

  // Connect נדרים פלוס in production mode.
  await page.getByRole('link', { name: 'הגדרות וחיבורים' }).click();
  await page.getByRole('tab', { name: 'חיבורים' }).click();
  const row = page.getByRole('row', { name: /חברת סליקה/ });
  await row.getByRole('button', { name: 'הגדרה' }).click();
  const c = page.getByRole('dialog', { name: /חיבור חברת סליקה/ });
  await c.getByLabel('מספר מוסד בנדרים פלוס').fill('7001234');
  await c.getByLabel(/ApiValid/).fill('e2e-api-valid');
  await c.getByLabel('מצב').selectOption('live');
  await c.getByRole('button', { name: 'חיבור' }).click();
  await expect(page.getByRole('dialog', { name: 'החיבור הוגדר' })).toContainText('במצב ייצור');
  await page.getByRole('button', { name: 'סגירה' }).click();
  await expect(row).toContainText('נדרים פלוס, מוסד 70***34 · מצב ייצור');

  // A student, and a card payment.
  await page.getByRole('link', { name: 'תלמידים ומשפחות' }).click();
  await page.getByRole('button', { name: 'תלמיד חדש' }).click();
  const d = page.getByRole('dialog', { name: 'תלמיד חדש' });
  await d.getByLabel('שם התלמיד המלא').fill('נחום ברגר');
  await d.getByLabel('כיתה').selectOption("ג'");
  await d.getByLabel('שם ההורה').fill('ישראל ברגר');
  await d.getByLabel('טלפון').fill('055-3434343');
  await d.getByRole('button', { name: 'שמירה' }).click();
  await page.getByRole('dialog', { name: 'התלמיד נוסף' }).getByRole('button', { name: 'סגור' }).click();
  await page.getByRole('button', { name: 'כרטיס תלמיד נחום ברגר' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'קבלת תשלום' }).click();
  const pay = page.getByRole('dialog', { name: 'קבלת תשלום' });
  await pay.getByLabel('סכום (₪)').fill('500');
  await pay.getByLabel('אמצעי תשלום').selectOption('card');
  await pay.getByRole('button', { name: 'המשך' }).click();
  const det = page.getByRole('dialog', { name: /אשראי/ });
  await expect(det).toContainText('פרטי הכרטיס מוקלדים אצל נדרים פלוס');
  const frame = page.frameLocator('iframe[title="טופס תשלום מאובטח של נדרים פלוס"]');
  await expect(frame.getByLabel('מספר כרטיס')).toBeVisible();
  await det.getByRole('button', { name: 'חיוב' }).click();

  const done = page.getByRole('dialog', { name: 'התשלום התקבל' });
  await expect(done).toContainText(/קבלה מס׳ \d+ הופקה/);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ Mosad: '7001234', Amount: '500', FirstName: 'ישראל ברגר' });
  // Nothing about the card itself leaves our page.
  expect(Object.keys(sent[0]!).some((k) => /card|cvv|tokef/i.test(k))).toBe(false);
  await done.getByRole('button', { name: 'צפייה והדפסה' }).click();
  await expect(page.getByRole('dialog', { name: /קבלה מס׳/ })).toContainText(
    'נדרים פלוס · ****4580 · אישור 0777',
  );
  await page.keyboard.press('Escape');

  // Back to the built-in test provider for the specs that follow.
  await page.getByRole('link', { name: 'הגדרות וחיבורים' }).click();
  await page.getByRole('tab', { name: 'חיבורים' }).click();
  await row.getByRole('button', { name: 'ניתוק' }).click();
  await page.getByRole('dialog', { name: /ניתוק/ }).getByRole('button', { name: 'ניתוק' }).click();
  await expect(row).toContainText('לא מחובר');
});
