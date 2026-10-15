import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runDailyReminders } from '../src/modules/messages/service';
import { codeForSpeech, forSpeech } from '../src/providers/messaging/yemot';
import { Agent, makeApp, signedIn, type TestCtx } from './helpers';
import { key, mockCard, newFamily } from './finance-helpers';

/** A stand-in for ימות המשיח: records every request and answers as configured. */
function fakeYemot(
  answer: (method: string, form: URLSearchParams) => Record<string, unknown> = () => ({
    responseStatus: 'OK',
    campaignId: 'c-1',
  }),
) {
  const calls: { url: string; method: string; form: URLSearchParams }[] = [];
  const http = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const form = new URLSearchParams(String(init?.body ?? ''));
    const method = u.split('/').pop()!;
    calls.push({ url: u, method, form });
    return new Response(JSON.stringify(answer(method, form)), {
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { http, calls };
}

let ctx: TestCtx;
let a: Agent;
let yemot: ReturnType<typeof fakeYemot>;
const il = (s: string) => new Date(`${s}+03:00`);

async function connectVoice(mode: 'test' | 'live' = 'live') {
  const r = await a.req('POST', '/api/settings/integrations/voice', {
    username: '0771234567',
    secret: 'Yemot-Pass-77',
    mode,
    callerId: '0771234567',
  });
  expect(r.statusCode, r.body).toBe(200);
  return r.json().integration;
}

beforeEach(async () => {
  yemot = fakeYemot();
  ctx = await makeApp({}, yemot.http);
  ctx.deps.clock.set(il('2026-10-14T10:00:00'));
  a = (await signedIn(ctx)).agent;
});
afterEach(() => ctx.close());

describe('text for speech', () => {
  it('drops links, speaks shekel amounts and reads codes digit by digit', () => {
    expect(forSpeech('שלום דוד, יתרה של ₪9,650. לתשלום: http://localhost:5173/portal?t=abc')).toBe(
      'שלום דוד, יתרה של 9650 שקלים. לתשלום: בפורטל ההורים',
    );
    expect(codeForSpeech('204816')).toBe('2, 0, 4, 8, 1, 6. אני חוזר: 2, 0, 4, 8, 1, 6');
  });
});

describe('voice calls through ימות המשיח instead of SMS (stage 9)', () => {
  it('until the connection is live, nothing is dialled and SMS falls back to email', async () => {
    await connectVoice('test');
    expect((await a.req('GET', '/api/auth/me')).json().school.voice).toBe(false);
    const f = await newFamily(a, 'יוסף כהן', 'דוד כהן', '050-1111111', 'cohen@example.com');
    const r = await a.req('POST', `/api/families/${f.familyId}/statement/send`, { channel: 'voice' });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.message).toContain('ימות המשיח');
    expect(yemot.calls).toEqual([]);
  });

  it('production mode exists only for voice; credentials stay encrypted', async () => {
    const sms = await a.req('POST', '/api/settings/integrations/accounting', {
      username: 'x',
      secret: 'y',
      mode: 'live',
    });
    expect(sms.statusCode).toBe(400);
    const row = await connectVoice();
    expect(row).toMatchObject({ connected: true, mode: 'live', details: 'מערכת 07***67 · מצב ייצור' });
    const scan = (await new Agent(ctx.app).req('GET', '/api/test/scan?needle=Yemot-Pass-77')).json();
    expect(scan.hits).toEqual([]);
    expect((await a.req('GET', '/api/auth/me')).json().school.voice).toBe(true);
  });

  it('a reminder stored as SMS becomes a call that reads the message, with the token only in the form body', async () => {
    await connectVoice();
    const f = await newFamily(a, 'יוסף כהן', 'דוד כהן', '050-1111111', 'cohen@example.com');
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
    await runDailyReminders(ctx.deps);
    const m = await ctx.deps.db.message.findFirstOrThrow({ where: { ruleKey: 'pre_charge' } });
    expect(m).toMatchObject({ channel: 'voice', to: '0501111111', status: 'sent', providerRef: 'yemot_c-1' });
    const call = yemot.calls.find((x) => x.method === 'SendTTS')!;
    expect(call.url).toBe('https://www.call2all.co.il/ym/api/SendTTS');
    expect(call.url).not.toContain('token');
    expect(call.form.get('token')).toBe('0771234567:Yemot-Pass-77');
    expect(call.form.get('phones')).toBe('0501111111');
    expect(call.form.get('callerId')).toBe('0771234567');
    expect(call.form.get('ttsMessage')).not.toMatch(/https?:|₪/);
    expect(call.form.get('ttsMessage')).toContain('שקלים');
    expect(ctx.logs.join('')).not.toContain('Yemot-Pass-77');
  });

  it('a refused call is recorded as failed, without the password', async () => {
    yemot = fakeYemot(() => ({ responseStatus: 'EXCEPTION', message: 'bad token 0771234567:Yemot-Pass-77' }));
    await ctx.close();
    ctx = await makeApp({}, yemot.http);
    a = (await signedIn(ctx)).agent;
    await connectVoice();
    const f = await newFamily(a, 'יוסף כהן', 'דוד כהן', '050-1111111');
    const r = await a.req('POST', `/api/families/${f.familyId}/statement/send`, { channel: 'voice' });
    expect(r.statusCode).toBe(400);
    expect(r.body).not.toContain('Yemot-Pass-77');
    const m = await ctx.deps.db.message.findFirstOrThrow();
    expect(m.status).toBe('failed');
    expect(m.error).toContain('ימות המשיח');
    expect(m.error).not.toContain('Yemot-Pass-77');
  });

  it('a parent who types the phone gets the sign-in code read out in a call', async () => {
    await connectVoice();
    await newFamily(a, 'משה לוי', 'רחל לוי', '050-2222222');
    const p = new Agent(ctx.app);
    expect((await p.req('GET', '/api/portal/login/options')).json()).toEqual({
      textMessaging: false,
      voice: true,
    });
    const s = (await p.req('POST', '/api/portal/login/start', { contact: '050-2222222' })).json();
    const call = yemot.calls.find((x) => x.method === 'SendTTS')!;
    expect(call.form.get('phones')).toBe('0502222222');
    const spoken = call.form.get('ttsMessage')!;
    expect(spoken).toMatch(/קוד הכניסה לפורטל ההורים הוא: (\d, ){5}\d\. אני חוזר/);
    const code = spoken.match(/(\d, ){5}\d/)![0].replace(/, /g, '');
    // The code is not kept: no message history, only a keyed hash.
    expect(await ctx.deps.db.message.count()).toBe(0);
    expect(
      (await p.req('POST', '/api/portal/login/verify', { challengeId: s.challengeId, code })).statusCode,
    ).toBe(200);
    expect(ctx.logs.join('')).not.toContain(code);
  });

  it('with an email on file the code still goes by email unless the parent asks for a call', async () => {
    await connectVoice();
    await newFamily(a, 'יוסף כהן', 'דוד כהן', '050-1111111', 'cohen@example.com');
    await new Agent(ctx.app).req('POST', '/api/portal/login/start', { contact: 'cohen@example.com' });
    expect(yemot.calls.filter((x) => x.method === 'SendTTS')).toEqual([]);
    expect((await ctx.deps.db.outbox.findFirstOrThrow({ where: { to: 'cohen@example.com' } })).subject).toBe(
      'קוד כניסה לפורטל ההורים',
    );
  });

  it('"test connection" checks the login without placing a call', async () => {
    await connectVoice('test');
    const r = (await a.req('POST', '/api/settings/integrations/voice/test')).json();
    expect(r).toMatchObject({ ok: true });
    expect(yemot.calls.map((x) => x.method)).toEqual(['GetSession']);
  });
});
