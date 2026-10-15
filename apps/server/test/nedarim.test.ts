import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseCallback, transactionFields } from '../src/providers/payment/nedarim';
import { Agent, makeApp, setSettings, signedIn, type TestCtx } from './helpers';
import { key, mockCard, newFamily } from './finance-helpers';

let ctx: TestCtx;
let a: Agent;
const il = (s: string) => new Date(`${s}+03:00`);
const NEDARIM_IP = '18.194.219.73';

beforeEach(async () => {
  ctx = await makeApp();
  ctx.deps.clock.set(il('2026-10-14T10:00:00'));
  a = (await signedIn(ctx)).agent;
});
afterEach(() => ctx.close());

async function connectNedarim(mode: 'test' | 'live' = 'live') {
  const r = await a.req('POST', '/api/settings/integrations/card', {
    username: '7001234',
    secret: 'Nedarim-ApiValid-55',
    mode,
  });
  expect(r.statusCode, r.body).toBe(200);
  return r.json().integration;
}

/** Nedarim's server calling ours. */
const callback = (body: Record<string, unknown>, ip = NEDARIM_IP, contentType = 'text/plain') =>
  ctx.app.inject({
    method: 'POST',
    url: '/api/webhooks/nedarim',
    remoteAddress: ip,
    payload: JSON.stringify(body),
    headers: { 'content-type': contentType },
  });

async function start(familyId: string, amountAgorot: number, idem = key()) {
  const r = await a.req('POST', '/api/payments/nedarim', { familyId, amountAgorot, idempotencyKey: idem });
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as { intentId: string; transaction: Record<string, string>; origins: string[] };
}

const success = (intentId: string, amount: string) => ({
  Status: 'OK',
  Param1: intentId,
  Amount: amount,
  TransactionId: '998877',
  Confirmation: '0123456',
  LastNum: '4580',
});

describe('נדרים פלוס: protocol helpers', () => {
  it('builds the full FinishTransaction2 field set and reads callbacks tolerantly', () => {
    const t = transactionFields(
      { mosad: '7001234', apiValid: 'k' },
      {
        intentId: 'abc',
        amountAgorot: 965050,
        payerName: 'דוד כהן',
        phone: '050',
        email: '',
        comment: 'x',
        callbackUrl: 'https://s/cb',
      },
    );
    expect(t).toMatchObject({ Mosad: '7001234', Amount: '9650.50', Param1: 'abc', CallBack: 'https://s/cb' });
    expect(Object.keys(t)).toHaveLength(19);
    expect(
      transactionFields(
        { mosad: '1', apiValid: 'k' },
        {
          ...t,
          intentId: 'a',
          amountAgorot: 10000,
          payerName: '',
          phone: '',
          email: '',
          comment: '',
          callbackUrl: '',
        },
      ).Amount,
    ).toBe('100');
    expect(parseCallback({ status: 'ok', param1: 'i', amount: '100', lastnum: '1234' })).toMatchObject({
      ok: true,
      intentId: 'i',
      amountAgorot: 10000,
      last4: '1234',
    });
    expect(parseCallback({ Status: 'Error', Param1: 'i', Message: 'כרטיס חסום' })).toMatchObject({
      ok: false,
      message: 'כרטיס חסום',
    });
    expect(parseCallback({ Status: 'pending', Param1: 'i' }).ok).toBe(false);
  });
});

describe('נדרים פלוס: card payments in their iframe', () => {
  it('stays on the built-in test provider until connected in production mode', async () => {
    expect((await a.req('GET', '/api/payments/card-mode')).json()).toEqual({
      mode: 'hosted',
      iframeUrl: null,
    });
    await connectNedarim('test');
    expect((await a.req('GET', '/api/payments/card-mode')).json().mode).toBe('hosted');
    const f = await newFamily(a);
    const r = await a.req('POST', '/api/payments/nedarim', {
      familyId: f.familyId,
      amountAgorot: 10000,
      idempotencyKey: key(),
    });
    expect(r.statusCode).toBe(400);
  });

  it('pays only on the server callback from Nedarim, with the receipt, once', async () => {
    const row = await connectNedarim();
    expect(row.details).toBe('נדרים פלוס, מוסד 70***34 · מצב ייצור');
    expect((await a.req('GET', '/api/payments/card-mode')).json()).toMatchObject({ mode: 'nedarim' });
    const f = await newFamily(a);
    const idem = key();
    const s = await start(f.familyId, 100000, idem);
    expect(s.transaction).toMatchObject({
      Mosad: '7001234',
      ApiValid: 'Nedarim-ApiValid-55',
      Amount: '1000',
      Param1: s.intentId,
      CallBack: 'http://localhost:5173/api/webhooks/nedarim',
      FirstName: 'דוד כהן',
    });
    expect(s.origins).toContain('https://www.matara.pro');
    // The same key opens the same payment.
    expect((await start(f.familyId, 100000, idem)).intentId).toBe(s.intentId);
    expect((await a.req('GET', `/api/payments/nedarim/${s.intentId}`)).json()).toMatchObject({
      status: 'pending',
    });

    // Not from Nedarim's address: refused, nothing recorded.
    expect((await callback(success(s.intentId, '1000'), '10.1.2.3')).statusCode).toBe(403);
    // The amount must match what we asked for.
    expect((await callback(success(s.intentId, '1'))).statusCode).toBe(400);
    expect(await ctx.deps.db.payment.count()).toBe(0);

    const ok = await callback(success(s.intentId, '1000'));
    expect(ok.statusCode, ok.body).toBe(200);
    const st = (await a.req('GET', `/api/payments/nedarim/${s.intentId}`)).json();
    expect(st.status).toBe('paid');
    expect(st.result.receipt.number).toBeGreaterThan(0);
    const p = await ctx.deps.db.payment.findFirstOrThrow();
    expect(p).toMatchObject({ method: 'card', amountAgorot: 100000, idempotencyKey: idem });
    expect(p.reference).toBe('נדרים פלוס · ****4580 · אישור 0123456');
    const txn = await ctx.deps.db.cardTransaction.findFirstOrThrow({ where: { id: p.cardTxnId! } });
    expect(txn).toMatchObject({ status: 'approved', providerTxnId: '998877' });

    // Nedarim retries the callback: nothing changes.
    expect((await callback(success(s.intentId, '1000'))).statusCode).toBe(200);
    expect(await ctx.deps.db.payment.count()).toBe(1);
    // A finished payment cannot be reopened with its key.
    const again = await a.req('POST', '/api/payments/nedarim', {
      familyId: f.familyId,
      amountAgorot: 100000,
      idempotencyKey: idem,
    });
    expect(again.statusCode).toBe(409);
    // The ApiValid is stored encrypted only.
    const scan = (await new Agent(ctx.app).req('GET', '/api/test/scan?needle=Nedarim-ApiValid-55')).json();
    expect(scan.hits).toEqual([]);
  });

  it('records a declined charge as failed without a payment, also from a form body', async () => {
    await connectNedarim();
    const f = await newFamily(a);
    const s = await start(f.familyId, 5000);
    const r = await ctx.app.inject({
      method: 'POST',
      url: '/api/webhooks/nedarim',
      remoteAddress: NEDARIM_IP,
      payload: new URLSearchParams({ Status: 'Error', Param1: s.intentId, Message: 'סירוב' }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    expect(r.statusCode, r.body).toBe(200);
    expect((await a.req('GET', `/api/payments/nedarim/${s.intentId}`)).json()).toMatchObject({
      status: 'failed',
      message: 'סירוב',
    });
    expect(await ctx.deps.db.payment.count()).toBe(0);
    // A late "success" for a failed payment changes nothing.
    await callback(success(s.intentId, '50'));
    expect(await ctx.deps.db.payment.count()).toBe(0);
    expect((await callback({ Status: 'OK', Param1: 'no-such-intent-0000' })).statusCode).toBe(404);
    expect((await callback({ Status: 'OK' })).statusCode).toBe(400);
  });

  it('turns off saved cards and token charges, which go through our server, while Nedarim is live', async () => {
    await connectNedarim();
    const f = await newFamily(a);
    const { save: _s, ...c } = mockCard('4242');
    const saved = await a.req('POST', '/api/cards', { studentId: f.studentId, card: c });
    expect(saved.statusCode).toBe(400);
    const paid = await a.req('POST', '/api/payments', {
      idempotencyKey: key(),
      familyId: f.familyId,
      amountAgorot: 1000,
      details: { method: 'card', newCard: mockCard('4242') },
    });
    expect(paid.statusCode).toBe(400);
    expect(paid.json().error.message).toContain('נדרים');
  });

  it('a parent pays from the portal only for their own family', async () => {
    await setSettings(ctx, { textMessaging: true });
    await connectNedarim();
    const A = await newFamily(a, 'יוסף כהן', 'דוד כהן', '050-1111111');
    const B = await newFamily(a, 'משה לוי', 'אברהם לוי', '050-2222222');
    const bIntent = (await start(B.familyId, 1000)).intentId;

    const p = new Agent(ctx.app);
    const st = await p.req('POST', '/api/portal/login/start', { contact: '050-1111111' });
    const text = (await new Agent(ctx.app).req('GET', '/api/test/texts?to=0501111111')).json().texts[0].body;
    await p.req('POST', '/api/portal/login/verify', {
      challengeId: st.json().challengeId,
      code: text.match(/\d{6}/)[0],
      trustDevice: false,
    });
    p.csrf = (await p.req('GET', '/api/portal/me')).json().csrfToken;

    expect((await p.req('GET', '/api/portal/card-mode')).json().mode).toBe('nedarim');
    expect((await p.req('GET', `/api/portal/pay/nedarim/${bIntent}`)).statusCode).toBe(404);
    const r = await p.req('POST', '/api/portal/pay/nedarim', { amountAgorot: 20000, idempotencyKey: key() });
    expect(r.statusCode, r.body).toBe(200);
    const mine = r.json();
    expect(mine.transaction.FirstName).toBe('דוד כהן');
    await callback(success(mine.intentId, '200'));
    expect((await p.req('GET', `/api/portal/pay/nedarim/${mine.intentId}`)).json().status).toBe('paid');
    const pay = await ctx.deps.db.payment.findFirstOrThrow();
    expect(pay).toMatchObject({ familyId: A.familyId, source: 'portal', createdById: null });
    // The old card form of the portal is closed.
    const old = await p.req('POST', '/api/portal/pay', {
      amountAgorot: 100,
      idempotencyKey: key(),
      newCard: mockCard('4242'),
    });
    expect(old.statusCode).toBe(400);
  });

  it('lets the payment page frame Nedarim only', async () => {
    const r = await a.req('GET', '/api/auth/me');
    const csp = r.headers['content-security-policy'] as string;
    expect(csp).toMatch(/frame-src[^;]*https:\/\/www\.matara\.pro/);
    expect(csp).toContain("frame-ancestors 'none'");
  });
});
