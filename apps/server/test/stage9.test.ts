import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { familyVars, runDailyReminders } from '../src/modules/messages/service';
import { Agent, makeApp, signedIn, type TestCtx } from './helpers';
import { addStudent, key, mockCard, newFamily } from './finance-helpers';

let ctx: TestCtx;
let a: Agent;
const il = (s: string) => new Date(`${s}+03:00`);

beforeEach(async () => {
  ctx = await makeApp();
  ctx.deps.clock.set(il('2026-10-14T10:00:00'));
  a = (await signedIn(ctx)).agent;
});
afterEach(() => ctx.close());

const texts = async () => (await new Agent(ctx.app).req('GET', '/api/test/texts')).json().texts as unknown[];
const mailsTo = (to: string) =>
  ctx.deps.db.outbox.findMany({ where: { to }, orderBy: { createdAt: 'desc' } });
const cohen = () => newFamily(a, 'יוסף כהן', 'דוד כהן', '050-1111111', 'cohen@example.com');

describe('email only (stage 9: the school uses no SMS and no WhatsApp)', () => {
  it('is the default, and staff screens are told so', async () => {
    expect((await a.req('GET', '/api/settings')).json().settings.textMessaging).toBe(false);
    expect((await a.req('GET', '/api/auth/me')).json().school.textMessaging).toBe(false);
    const rules = (await a.req('GET', '/api/messages/rules')).json().rules;
    expect(rules.map((r: { channel: string }) => r.channel)).toEqual(['email', 'email', 'email', 'email']);
  });

  it('refuses SMS and WhatsApp in every manual send, and sends by email', async () => {
    const f = await cohen();
    for (const ch of ['sms', 'whatsapp']) {
      const g = await a.req('POST', '/api/messages/group/preview', {
        group: 'all',
        channel: ch,
        template: 'x {יתרה}',
      });
      expect(g.statusCode).toBe(400);
      expect(g.json().error.message).toContain('מייל בלבד');
      expect(
        (await a.req('POST', `/api/families/${f.familyId}/statement/send`, { channel: ch })).statusCode,
      ).toBe(400);
      const r = await a.req('PATCH', '/api/messages/rules/pre_charge', {
        channel: ch,
        enabled: true,
        template: 'x',
      });
      expect(r.statusCode).toBe(400);
    }
    const sent = await a.req('POST', '/api/messages/group', {
      group: 'all',
      channel: 'email',
      template: 'שלום {הורה}',
    });
    expect(sent.statusCode, sent.body).toBe(200);
    expect((await mailsTo('cohen@example.com'))[0]!.text).toBe('שלום דוד כהן');
    expect(await texts()).toEqual([]);
  });

  it('automatic reminders stored as SMS go by email instead', async () => {
    const f = await cohen();
    const { save: _s, ...c } = mockCard('4242');
    const cardId = (await a.req('POST', '/api/cards', { studentId: f.studentId, card: c })).json().card.id;
    await a.req('POST', '/api/plans', {
      plan: {
        studentId: f.studentId,
        type: 'installments',
        amountAgorot: 200000,
        count: 2,
        startDate: '2026-10-17',
        method: 'card',
        cardId,
      },
      idempotencyKey: key(),
      consent: { method: 'phone', confirmed: true },
    });
    // Rule 1 ("3 days before a card charge") is stored with SMS, as in the demo.
    expect((await ctx.deps.db.reminderRule.findUniqueOrThrow({ where: { key: 'pre_charge' } })).channel).toBe(
      'sms',
    );
    await runDailyReminders(ctx.deps);
    const m = await ctx.deps.db.message.findFirstOrThrow({ where: { ruleKey: 'pre_charge' } });
    expect(m).toMatchObject({ channel: 'email', to: 'cohen@example.com', status: 'sent' });
    expect(await texts()).toEqual([]);
  });

  it('portal codes go to the family email, also when the parent types the phone number', async () => {
    const f = await cohen();
    const p = new Agent(ctx.app);
    expect((await p.req('GET', '/api/portal/login/options')).json()).toEqual({ textMessaging: false });
    const s = (await p.req('POST', '/api/portal/login/start', { contact: '050-1111111' })).json();
    expect(s.sentTo).toBeNull();
    const mail = (await mailsTo('cohen@example.com'))[0]!;
    expect(mail.subject).toBe('קוד כניסה לפורטל ההורים');
    const code = mail.text.match(/\d{6}/)![0];
    expect(
      (await p.req('POST', '/api/portal/login/verify', { challengeId: s.challengeId, code })).statusCode,
    ).toBe(200);
    expect(await texts()).toEqual([]);

    // With the signed link, the masked email is shown even if "SMS" was asked for.
    const link = decodeURIComponent(
      String((await familyVars(ctx.deps, ctx.deps.db, f.familyId))['קישור']).split('?t=')[1]!,
    );
    const viaLink = (
      await new Agent(ctx.app).req('POST', '/api/portal/login/start', { link, channel: 'sms' })
    ).json();
    expect(viaLink.sentTo).toBe('c***@example.com');
  });

  it('a family without email: a link explains it, a typed phone gets the generic answer and nothing is sent', async () => {
    const f = await newFamily(a, 'משה לוי', 'רחל לוי', '050-2222222');
    const link = decodeURIComponent(
      String((await familyVars(ctx.deps, ctx.deps.db, f.familyId))['קישור']).split('?t=')[1]!,
    );
    const r = await new Agent(ctx.app).req('POST', '/api/portal/login/start', { link });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.message).toBe('לא רשומה כתובת מייל למשפחה. יש לפנות למזכירות בית הספר');
    const g = await new Agent(ctx.app).req('POST', '/api/portal/login/start', { contact: '050-2222222' });
    expect(g.statusCode).toBe(200);
    expect(await ctx.deps.db.parentOtp.count()).toBe(0);
    expect(await texts()).toEqual([]);
  });

  it('a rejected request reaches the parent by email', async () => {
    await cohen();
    const p = new Agent(ctx.app);
    const s = (await p.req('POST', '/api/portal/login/start', { contact: 'cohen@example.com' })).json();
    const code = (await mailsTo('cohen@example.com'))[0]!.text.match(/\d{6}/)![0];
    await p.req('POST', '/api/portal/login/verify', { challengeId: s.challengeId, code });
    p.csrf = (await p.req('GET', '/api/portal/me')).json().csrfToken;
    const req = (
      await p.req('POST', '/api/portal/requests', { type: 'discount', pct: 20, studentId: null })
    ).json();
    await a.req('POST', `/api/requests/${req.id}/reject`, { reason: 'לא עומד בקריטריונים' });
    expect((await mailsTo('cohen@example.com'))[0]!.text).toBe(
      'בקשת ההנחה שלך נדחתה. סיבה: לא עומד בקריטריונים',
    );
    expect(await texts()).toEqual([]);
  });

  it('SMS and WhatsApp connections are "not in use" and cannot be set up', async () => {
    const list = (await a.req('GET', '/api/settings/integrations')).json().integrations;
    const sms = list.find((i: { key: string }) => i.key === 'sms');
    expect(sms.provider).toBe('לא בשימוש: המערכת שולחת הודעות במייל בלבד');
    const r = await a.req('POST', '/api/settings/integrations/whatsapp', {
      username: 'x',
      secret: 'y',
      mode: 'test',
    });
    expect(r.statusCode).toBe(400);
  });

  it('the switch turns text messaging back on, and it is audited', async () => {
    const s = (await a.req('GET', '/api/settings')).json().settings;
    const r = await a.req('PATCH', '/api/settings/general', {
      schoolName: s.schoolName,
      siblingPct: s.siblingPct,
      checkReturnFeeAgorot: s.checkReturnFeeAgorot,
      autoRunTime: s.autoRunTime,
      backupFrequency: s.backupFrequency,
      grades: s.grades,
      textMessaging: true,
    });
    expect(r.statusCode).toBe(200);
    expect((await a.req('GET', '/api/messages/rules')).json().rules[0].channel).toBe('sms');
    const f = await cohen();
    await addStudent(a, { fullName: 'שרה כהן', familyId: f.familyId });
    expect(
      (await a.req('POST', '/api/messages/group/preview', { group: 'all', channel: 'sms', template: 'x' }))
        .statusCode,
    ).toBe(200);
    const audit = await ctx.deps.db.auditLog.findFirstOrThrow({ where: { action: 'settings.general' } });
    expect(JSON.parse(audit.after!).textMessaging).toBe(true);
  });
});

describe('email connection test (real SMTP when configured)', () => {
  it('outbox mode says so and leaves a test mail for the user who asked', async () => {
    const r = (await a.req('POST', '/api/settings/integrations/email/test')).json();
    expect(r.ok).toBe(true);
    expect(r.messageHe).toContain('תיבת יוצא פנימית');
    const me = (await a.req('GET', '/api/auth/me')).json().user.email;
    expect((await mailsTo(me))[0]!.subject).toBe('בדיקת חיבור מייל');
  });

  it('a refused SMTP server is reported without the password', async () => {
    const other = await makeApp({
      MAIL_TRANSPORT: 'smtp',
      SMTP_URL: 'smtp://school:Very-Secret-Pw@127.0.0.1:1',
    });
    const b = (await signedIn(other)).agent;
    const r = await b.req('POST', '/api/settings/integrations/email/test');
    expect(r.json().ok).toBe(false);
    expect(r.json().messageHe).toContain('שרת המייל דחה את החיבור');
    expect(r.body).not.toContain('Very-Secret-Pw');
    await other.close();
  });
});
