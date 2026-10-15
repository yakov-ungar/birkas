import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { israelDate } from '../src/lib/clock';
import { dispatch, runDailyReminders } from '../src/modules/messages/service';
import { runDueCharges } from '../src/modules/plans/service';
import { makeApp, setSettings, signedIn, type Agent, type TestCtx } from './helpers';
import { addStudent, key, mockCard, newFamily, openCash, pay, cash } from './finance-helpers';

let ctx: TestCtx;
let a: Agent;
const il = (s: string) => new Date(`${s}+03:00`);
/** Sign in again after a clock jump (the old session would be idle-expired). */
async function jump(to: Date) {
  ctx.deps.clock.set(to);
  a = (await signedIn(ctx)).agent;
}

beforeEach(async () => {
  ctx = await makeApp();
  // These tests cover SMS and WhatsApp, which the school switched off by default (stage 9).
  await setSettings(ctx, { textMessaging: true });
  ctx.deps.clock.set(il('2026-10-14T10:00:00')); // a Wednesday, inside allowed hours
  a = (await signedIn(ctx)).agent;
});
afterEach(() => ctx.close());

const today = () => israelDate(ctx.deps.clock.now());
const messages = () => ctx.deps.db.message.findMany({ orderBy: { createdAt: 'asc' } });

async function cardPlan(studentId: string, last4: string, startDate = today()) {
  const { save: _s, ...c } = mockCard(last4);
  const cardId = (await a.req('POST', '/api/cards', { studentId, card: c })).json().card.id;
  return (
    await a.req('POST', '/api/plans', {
      plan: {
        studentId,
        type: 'installments',
        amountAgorot: 200000,
        count: 2,
        startDate,
        method: 'card',
        cardId,
      },
      idempotencyKey: key(),
      consent: { method: 'phone', confirmed: true },
    })
  ).json();
}

describe('contact log and payment promises', () => {
  it('records notes, requires date and amount for a promise, and shows it on the family', async () => {
    const f = await newFamily(a);
    expect(
      (await a.req('POST', `/api/families/${f.familyId}/notes`, { type: 'promise', note: 'ישלם אחרי החג' }))
        .statusCode,
    ).toBe(400);
    await a.req('POST', `/api/families/${f.familyId}/notes`, { type: 'call', note: 'שיחה עם האב' });
    await a.req('POST', `/api/families/${f.familyId}/notes`, {
      type: 'promise',
      note: 'ישלם אחרי החג',
      promiseDate: '2026-10-20',
      promiseAgorot: 200000,
    });
    const fam = (await a.req('GET', `/api/families/${f.familyId}`)).json();
    expect(fam.notes).toHaveLength(2);
    expect(fam.promise).toMatchObject({ date: '2026-10-20', amountAgorot: 200000, status: 'pending' });
    const row = (await a.req('GET', '/api/families')).json().families[0];
    expect(row).toMatchObject({ lastContact: '2026-10-14', promise: { status: 'pending' } });
    const { agent: viewer } = await signedIn(ctx, ['stu_view']);
    expect((await viewer.req('GET', `/api/families/${f.familyId}`)).json().notes).toBeNull();
  });

  it('a promise is kept when the family pays the amount in time, and broken after the date', async () => {
    const f = await newFamily(a);
    const g = await newFamily(a, 'אברהם לוי', 'משה לוי', '052-2222222');
    await a.req('POST', `/api/families/${f.familyId}/notes`, {
      type: 'promise',
      note: 'x',
      promiseDate: '2026-10-20',
      promiseAgorot: 100000,
    });
    await a.req('POST', `/api/families/${g.familyId}/notes`, {
      type: 'promise',
      note: 'y',
      promiseDate: '2026-10-15',
      promiseAgorot: 100000,
    });
    await openCash(a);
    await pay(a, { studentId: f.studentId, amountAgorot: 100000, details: cash });
    expect((await a.req('GET', `/api/families/${f.familyId}`)).json().promise).toBeNull(); // kept
    expect((await a.req('GET', `/api/alerts`)).json().alerts.map((x: { text: string }) => x.text)).toContain(
      '1 הבטחות תשלום מגיעות בימים הקרובים או שעברו',
    );
    await jump(il('2026-10-18T10:00:00'));
    const debtors = (await a.req('GET', '/api/collection/debtors')).json().debtors;
    expect(debtors.find((d: { familyId: string }) => d.familyId === g.familyId).promise.status).toBe(
      'broken',
    );
    const notes = (await a.req('GET', `/api/families/${g.familyId}/notes`)).json().notes;
    await a.req('POST', `/api/notes/${notes[0].id}/fulfilled`);
    expect((await a.req('GET', `/api/families/${g.familyId}`)).json().promise).toBeNull();
  });

  it('filters debtors by debt age and balance', async () => {
    const f = await newFamily(a);
    await newFamily(a, 'אברהם לוי', 'משה לוי', '052-2222222');
    await a.req('POST', '/api/charges', {
      studentId: f.studentId,
      type: 'trip',
      description: 'טיול',
      amountAgorot: 5000,
      date: '2026-08-01',
    });
    expect((await a.req('GET', '/api/collection/debtors')).json().debtors).toHaveLength(2);
    expect(
      (await a.req('GET', '/api/collection/debtors?minAge=60'))
        .json()
        .debtors.map((d: { name: string }) => d.name),
    ).toEqual(['משפחת כהן']);
    expect((await a.req('GET', '/api/collection/debtors?minBalance=960000')).json().debtors).toHaveLength(1);
  });
});

describe('reminder rules', () => {
  it('has exactly the four demo rules: editable, not deletable, no new ones', async () => {
    const rules = (await a.req('GET', '/api/messages/rules')).json().rules;
    expect(
      rules.map((r: { key: string; enabled: boolean; channel: string }) => [r.key, r.enabled, r.channel]),
    ).toEqual([
      ['pre_charge', true, 'sms'],
      ['charge_failed', true, 'whatsapp'],
      ['debt_30', false, 'email'],
      ['receipt_auto', true, 'email'],
    ]);
    expect(
      (
        await a.req('PATCH', '/api/messages/rules/debt_30', {
          channel: 'sms',
          enabled: true,
          template: 'שלום {הורה}, יתרה {יתרה}',
        })
      ).statusCode,
    ).toBe(200);
    await expect(ctx.deps.db.$executeRawUnsafe(`DELETE FROM "ReminderRule"`)).rejects.toThrow(
      /cannot be deleted/,
    );
    await expect(
      ctx.deps.db.$executeRawUnsafe(
        `INSERT INTO "ReminderRule" VALUES ('x','x',1,'sms','x',CURRENT_TIMESTAMP)`,
      ),
    ).rejects.toThrow(/four demo rules/);
  });

  it('rule 2: a failed nightly charge messages the parent once, at 08:00 instead of 02:00', async () => {
    const f = await newFamily(a);
    await cardPlan(f.studentId, '0002');
    ctx.deps.clock.set(il('2026-10-15T02:00:00'));
    await runDueCharges(ctx.deps, { runKey: 'x', trigger: 'schedule' });
    let m = await messages();
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({
      channel: 'whatsapp',
      to: '0501111111',
      status: 'queued',
      ruleKey: 'charge_failed',
    });
    expect(m[0]!.body).toMatch(
      /^שלום דוד כהן, החיוב עבור יוסף לא עבר \(סירוב חברת האשראי\)\. אנא עדכנו כרטיס: http:\/\/localhost:5173\/portal\?t=\S+$/,
    );
    expect(m[0]!.notBefore.toISOString()).toBe(il('2026-10-15T08:00:00').toISOString());
    await dispatch(ctx.deps);
    expect((await messages())[0]!.status).toBe('queued');
    ctx.deps.clock.set(il('2026-10-15T08:05:00'));
    await dispatch(ctx.deps);
    m = await messages();
    expect(m[0]).toMatchObject({ status: 'sent' });
    expect(m[0]!.providerRef).toMatch(/^mock_whatsapp_/);
  });

  it('automatic texts wait out Shabbat', async () => {
    const f = await newFamily(a);
    await cardPlan(f.studentId, '0002', '2026-10-17');
    ctx.deps.clock.set(il('2026-10-17T12:00:00')); // Saturday
    await runDueCharges(ctx.deps, { runKey: 'y', trigger: 'manual' });
    const m = (await messages())[0]!;
    expect(m.notBefore.toISOString()).toBe(il('2026-10-18T08:00:00').toISOString());
  });

  it('rule 1: reminds three days before a card charge, once', async () => {
    const f = await newFamily(a);
    await cardPlan(f.studentId, '1111', '2026-10-16');
    const pv = (await a.req('GET', '/api/messages/rules/pre_charge/preview')).json();
    expect(pv).toMatchObject({
      count: 1,
      channel: 'sms',
      example: 'שלום דוד כהן, בתאריך 16/10/2026 יחויב כרטיסך בסך ₪1,000 עבור יוסף.',
    });
    expect((await runDailyReminders(ctx.deps)).ran).toBe(true);
    expect((await runDailyReminders(ctx.deps)).ran).toBe(false);
    expect((await a.req('POST', '/api/messages/rules/pre_charge/run')).json().queued).toBe(0); // dedupe
    expect(await ctx.deps.db.message.count({ where: { ruleKey: 'pre_charge', status: 'sent' } })).toBe(1);
  });

  it('rule 3: debt over 30 days, at most once in 14 days per family (when enabled)', async () => {
    const f = await newFamily(a, 'יוסף כהן', 'דוד כהן', '050-1111111', 'cohen@example.com');
    await a.req('POST', '/api/charges', {
      studentId: f.studentId,
      type: 'trip',
      description: 'טיול',
      amountAgorot: 5000,
      date: '2026-08-01',
    });
    expect((await a.req('GET', '/api/messages/rules/debt_30/preview')).json().count).toBe(1);
    await runDailyReminders(ctx.deps);
    expect(await ctx.deps.db.message.count()).toBe(0); // disabled by default, as in the demo
    await a.req('PATCH', '/api/messages/rules/debt_30', {
      channel: 'email',
      enabled: true,
      template: 'שלום {הורה}, קיימת יתרה פתוחה של {יתרה}. לתשלום: {קישור}',
    });
    expect((await a.req('POST', '/api/messages/rules/debt_30/run')).json().queued).toBe(1);
    const mail = await ctx.deps.db.outbox.findFirstOrThrow({ where: { to: 'cohen@example.com' } });
    expect(mail.text).toMatch(
      /^שלום דוד כהן, קיימת יתרה פתוחה של ₪9,650\. לתשלום: http:\/\/localhost:5173\/portal\?t=\S+$/,
    );
    await jump(il('2026-10-24T10:00:00'));
    expect((await a.req('POST', '/api/messages/rules/debt_30/run')).json().queued).toBe(0);
    await jump(il('2026-10-29T10:00:00'));
    expect((await a.req('POST', '/api/messages/rules/debt_30/run')).json().queued).toBe(1);
  });

  it('rule 4: the receipt follows the rule channel (SMS instead of email when changed)', async () => {
    const f = await newFamily(a, 'יוסף כהן', 'דוד כהן', '050-1111111', 'cohen@example.com');
    await openCash(a);
    await pay(a, { studentId: f.studentId, amountAgorot: 1000, details: cash });
    expect(await ctx.deps.db.outbox.count({ where: { to: 'cohen@example.com' } })).toBe(1);
    await a.req('PATCH', '/api/messages/rules/receipt_auto', {
      channel: 'sms',
      enabled: true,
      template: 'שלום {הורה}, התקבל תשלום. תודה.',
    });
    const p = (await pay(a, { studentId: f.studentId, amountAgorot: 2000, details: cash })).json();
    const m = await ctx.deps.db.message.findFirstOrThrow({ where: { ruleKey: 'receipt_auto' } });
    expect(m).toMatchObject({ channel: 'sms', status: 'sent', body: 'שלום דוד כהן, התקבל תשלום. תודה.' });
    expect(
      (await ctx.deps.db.receipt.findUniqueOrThrow({ where: { id: p.receipt.id } })).sentAt,
    ).not.toBeNull();
    await a.req('PATCH', '/api/messages/rules/receipt_auto', {
      channel: 'sms',
      enabled: false,
      template: 'x',
    });
    await pay(a, { studentId: f.studentId, amountAgorot: 3000, details: cash });
    expect(await ctx.deps.db.message.count({ where: { ruleKey: 'receipt_auto' } })).toBe(1);
  });
});

describe('group messages and history', () => {
  it('previews, sends to the chosen group (manual sends go now), and records the history', async () => {
    const f = await newFamily(a, 'יוסף כהן', 'דוד כהן', '050-1111111', 'cohen@example.com');
    await addStudent(a, {
      fullName: 'שמואל גולד',
      grade: "ד'",
      newFamily: { parentName: 'יעקב גולד', phone: '050-4444444' },
    });
    const tpl = 'שלום {הורה}, נשארה יתרה לתשלום שכר לימוד בסך {יתרה}. לתשלום מהיר: {קישור}';
    const pv = (
      await a.req('POST', '/api/messages/group/preview', { group: 'all', channel: 'sms', template: tpl })
    ).json();
    expect(pv.count).toBe(2);
    expect(pv.example).toContain('שלום דוד כהן, נשארה יתרה לתשלום שכר לימוד בסך ₪9,600');
    expect(
      (
        await a.req('POST', '/api/messages/group', {
          group: 'all',
          channel: 'sms',
          template: tpl,
          expectedCount: 3,
        })
      ).statusCode,
    ).toBe(409);
    ctx.deps.clock.set(il('2026-10-14T22:30:00')); // late: automatic texts would wait, manual ones go
    a = (await signedIn(ctx)).agent;
    const sent = (
      await a.req('POST', '/api/messages/group', {
        group: 'all',
        channel: 'sms',
        template: tpl,
        expectedCount: 2,
      })
    ).json();
    expect(sent).toMatchObject({ count: 2, failed: 0 });
    const byGrade = (
      await a.req('POST', '/api/messages/group/preview', {
        group: "grade:ד'",
        channel: 'email',
        template: tpl,
      })
    ).json();
    expect(byGrade.count).toBe(1);
    const mail = (
      await a.req('POST', '/api/messages/group', { group: "grade:ד'", channel: 'email', template: tpl })
    ).json();
    expect(mail.failed).toBe(1); // the Gold family has no email
    const hist = (await a.req('GET', '/api/messages/history')).json().batches;
    expect(hist[0]).toMatchObject({ channel: 'email', recipients: 1, failed: 1, source: 'manual' });
    expect(hist[1]).toMatchObject({ channel: 'sms', recipients: 2, sent: 2 });
    void f;
  });

  it('sends a statement by SMS', async () => {
    const f = await newFamily(a);
    expect(
      (await a.req('POST', `/api/families/${f.familyId}/statement/send`, { channel: 'sms' })).statusCode,
    ).toBe(200);
    expect((await messages())[0]).toMatchObject({
      channel: 'sms',
      status: 'sent',
      body: expect.stringMatching(
        /^שלום דוד כהן, דף חשבון נכון ל-14\/10\/2026: יתרה לתשלום ₪9,600\. לצפייה ותשלום: http:\/\/localhost:5173\/portal\?t=\S+$/,
      ),
    });
    expect(
      (await a.req('POST', `/api/families/${f.familyId}/statement/send`, { channel: 'email' })).statusCode,
    ).toBe(400);
  });
});
