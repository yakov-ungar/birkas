import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { israelDate } from '../src/lib/clock';
import { familyVars } from '../src/modules/messages/service';
import { Agent, makeApp, setSettings, signedIn, type TestCtx } from './helpers';
import { key, mockCard, newFamily, addStudent, pay } from './finance-helpers';

let ctx: TestCtx;
let a: Agent;
const il = (s: string) => new Date(`${s}+03:00`);
const today = () => israelDate(ctx.deps.clock.now());

beforeEach(async () => {
  ctx = await makeApp();
  // These tests cover SMS and WhatsApp, which the school switched off by default (stage 9).
  await setSettings(ctx, { textMessaging: true });
  ctx.deps.clock.set(il('2026-10-14T10:00:00'));
  a = (await signedIn(ctx)).agent;
});
afterEach(() => ctx.close());

const lastText = async (to: string) =>
  ((await new Agent(ctx.app).req('GET', `/api/test/texts?to=${to}`)).json().texts[0]?.body ?? null) as
    | string
    | null;
const codeIn = (s: string | null) => s?.match(/\d{6}/)?.[0] ?? null;

/** Full parent sign-in with the code from the mock SMS. */
async function parent(phone = '050-1111111', trustDevice = false) {
  const p = new Agent(ctx.app);
  const s = await p.req('POST', '/api/portal/login/start', { contact: phone });
  expect(s.statusCode).toBe(200);
  const code = codeIn(await lastText(phone.replace(/\D/g, '')));
  const v = await p.req('POST', '/api/portal/login/verify', {
    challengeId: s.json().challengeId,
    code,
    trustDevice,
  });
  expect(v.statusCode, v.body).toBe(200);
  p.csrf = (await p.req('GET', '/api/portal/me')).json().csrfToken;
  return p;
}

/** Two kids with tuition (and the sibling discount on the second). */
async function cohen() {
  const f = await newFamily(a);
  const s2 = await addStudent(a, { fullName: 'שרה כהן', familyId: f.familyId });
  return { familyId: f.familyId, s1: f.studentId, s2: s2.studentId };
}

describe('parent sign-in (decision C15)', () => {
  it('sends a code only to the registered phone, answers the same for unknown details, and signs in once', async () => {
    const f = await cohen();
    const anon = new Agent(ctx.app);
    const unknown = await anon.req('POST', '/api/portal/login/start', { contact: '052-9999999' });
    const known = await anon.req('POST', '/api/portal/login/start', { contact: '050-1111111' });
    expect(unknown.statusCode).toBe(200);
    expect(known.statusCode).toBe(200);
    expect(Object.keys(unknown.json())).toEqual(Object.keys(known.json()));
    expect(unknown.json().sentTo).toBeNull();
    expect(known.json().sentTo).toBeNull();
    expect(await lastText('0529999999')).toBeNull();
    const sms = await lastText('0501111111');
    expect(sms).toMatch(/^קוד הכניסה לפורטל ההורים של .+: \d{6}\n/);
    // The code is not kept in message history and only a keyed hash is stored.
    expect(await ctx.deps.db.message.count()).toBe(0);
    const otp = await ctx.deps.db.parentOtp.findFirstOrThrow();
    expect(otp.codeHash).not.toContain(codeIn(sms)!);

    const wrong = await anon.req('POST', '/api/portal/login/verify', {
      challengeId: known.json().challengeId,
      code: codeIn(sms) === '000000' ? '111111' : '000000',
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.message).toBe('הקוד שגוי או שפג תוקפו');
    const fake = await anon.req('POST', '/api/portal/login/verify', {
      challengeId: unknown.json().challengeId,
      code: '123456',
    });
    expect(fake.json().error.message).toBe('הקוד שגוי או שפג תוקפו');

    const ok = await anon.req('POST', '/api/portal/login/verify', {
      challengeId: known.json().challengeId,
      code: codeIn(sms),
    });
    expect(ok.statusCode).toBe(200);
    const c = ok.cookies.find((x) => x.name === 'psid')!;
    expect(c).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
    const me = (await anon.req('GET', '/api/portal/me')).json();
    expect(me).toMatchObject({ parentName: 'דוד כהן', familyName: 'משפחת כהן', readOnly: false });
    expect(me.students.map((s: { id: string }) => s.id)).toEqual([f.s1, f.s2]);

    // Neither the code nor the phone reaches the logs.
    const logs = ctx.logs.join('');
    expect(logs).not.toContain(codeIn(sms)!);
    expect(logs).not.toContain('0501111111');
    // A used code does not work again.
    const again = await new Agent(ctx.app).req('POST', '/api/portal/login/verify', {
      challengeId: known.json().challengeId,
      code: codeIn(sms),
    });
    expect(again.statusCode).toBe(400);
  });

  it('locks a code after 5 wrong tries, and sends at most 3 codes per family in 15 minutes', async () => {
    await cohen();
    const p = new Agent(ctx.app);
    const s = (await p.req('POST', '/api/portal/login/start', { contact: '0501111111' })).json();
    const code = codeIn(await lastText('0501111111'))!;
    const bad = code === '999999' ? '888888' : '999999';
    for (let i = 0; i < 5; i++)
      await p.req('POST', '/api/portal/login/verify', { challengeId: s.challengeId, code: bad });
    const late = await p.req('POST', '/api/portal/login/verify', { challengeId: s.challengeId, code });
    expect(late.statusCode).toBe(400);

    for (let i = 0; i < 4; i++)
      await new Agent(ctx.app).req('POST', '/api/portal/login/start', { contact: '0501111111' });
    expect(await ctx.deps.db.parentOtp.count()).toBe(3);
  });

  it('a code expires after 10 minutes', async () => {
    await cohen();
    const p = new Agent(ctx.app);
    const s = (await p.req('POST', '/api/portal/login/start', { contact: '0501111111' })).json();
    const code = codeIn(await lastText('0501111111'));
    ctx.deps.clock.advanceMinutes(11);
    expect(
      (await p.req('POST', '/api/portal/login/verify', { challengeId: s.challengeId, code })).statusCode,
    ).toBe(400);
  });

  it('the {קישור} link is signed, shows the masked phone, and expires after 7 days', async () => {
    const f = await cohen();
    const vars = await familyVars(ctx.deps, ctx.deps.db, f.familyId);
    const link = decodeURIComponent(String(vars['קישור']).split('?t=')[1]!);
    const p = new Agent(ctx.app);
    const r = await p.req('POST', '/api/portal/login/start', { link });
    expect(r.json().sentTo).toBe('******1111');
    expect(codeIn(await lastText('0501111111'))).not.toBeNull();
    const tampered = link.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
    expect((await p.req('POST', '/api/portal/login/start', { link: tampered })).statusCode).toBe(400);
    const other = await newFamily(a, 'משה לוי', 'רחל לוי', '050-2222222');
    const forged = `${other.familyId}.${link.split('.')[1]}.${link.split('.')[2]}`;
    expect((await p.req('POST', '/api/portal/login/start', { link: forged })).statusCode).toBe(400);
    ctx.deps.clock.advanceMinutes(8 * 24 * 60);
    expect((await p.req('POST', '/api/portal/login/start', { link })).statusCode).toBe(400);
  });

  it('times out after 15 idle minutes; a remembered device gets back in without a code; logout forgets it', async () => {
    await cohen();
    const p = await parent('050-1111111', true);
    ctx.deps.clock.advanceMinutes(16);
    const r = await p.req('GET', '/api/portal/me');
    expect(r.statusCode).toBe(401);
    expect(r.json().error.code).toBe('idle_timeout');
    expect((await p.req('POST', '/api/portal/login/device')).statusCode).toBe(200);
    p.csrf = (await p.req('GET', '/api/portal/me')).json().csrfToken;
    expect((await p.req('POST', '/api/portal/logout')).statusCode).toBe(200);
    expect((await p.req('GET', '/api/portal/me')).statusCode).toBe(401);
    expect((await p.req('POST', '/api/portal/login/device')).statusCode).toBe(401);
  });

  it('staff and parent sessions never open each other', async () => {
    await cohen();
    const p = await parent();
    expect((await p.req('GET', '/api/auth/me')).statusCode).toBe(401);
    expect((await p.req('GET', '/api/families')).statusCode).toBe(401);
    expect((await a.req('GET', '/api/portal/me')).statusCode).toBe(401);
  });

  it('requires the CSRF token on portal writes', async () => {
    await cohen();
    const p = await parent();
    p.csrf = '';
    const r = await p.req('POST', '/api/portal/requests', { type: 'contact', phone: '050-3333333' });
    expect(r.statusCode).toBe(403);
  });
});

describe('portal: family isolation (stage 6 acceptance)', () => {
  it("a parent of family A gets 404 or 403 on every portal endpoint with family B's ids", async () => {
    const A = await cohen();
    const B = await newFamily(a, 'משה לוי', 'רחל לוי', '050-2222222');
    const paid = (
      await pay(a, {
        familyId: B.familyId,
        amountAgorot: 100000,
        details: { method: 'card', newCard: mockCard('4242', true) },
      })
    ).json();
    const bReceipt: string = paid.receipt.id;
    const bCard = (await ctx.deps.db.savedCard.findFirstOrThrow({ where: { studentId: B.studentId } })).id;
    const bPayKey: string = (await ctx.deps.db.payment.findFirstOrThrow({ where: { familyId: B.familyId } }))
      .idempotencyKey!;
    const before = await ctx.deps.db.auditLog.count();

    const p = await parent();
    const routes = ctx.app.routeList.filter((r) => r.access.type === 'parent');
    const fill = (u: string) => u.replace(':id', bReceipt);
    const bodies: Record<string, unknown> = {
      'POST /api/portal/pay': { amountAgorot: 1000, idempotencyKey: key(), cardId: bCard },
      'POST /api/portal/cards': { studentId: B.studentId, card: { ...mockCard('5555'), save: undefined } },
      'POST /api/portal/requests': { type: 'discount', pct: 10, studentId: B.studentId },
    };
    const tried: string[] = [];
    for (const r of routes) {
      const k = `${r.method} ${r.url}`;
      // These take no ids: the family comes from the session alone.
      if (
        [
          'POST /api/portal/logout',
          'GET /api/portal/me',
          'GET /api/portal/card-mode',
          'POST /api/portal/pay/nedarim',
        ].includes(k)
      )
        continue;
      const res = await p.req(r.method, fill(r.url), r.method === 'GET' ? undefined : bodies[k]);
      expect([403, 404], `${k} → ${res.statusCode} ${res.body}`).toContain(res.statusCode);
      tried.push(k);
    }
    expect(tried.sort()).toEqual([
      'GET /api/portal/pay/nedarim/:id',
      'GET /api/portal/receipts/:id/pdf',
      'POST /api/portal/cards',
      'POST /api/portal/pay',
      'POST /api/portal/requests',
    ]);
    // Replaying family B's payment key returns nothing of B's.
    const replay = await p.req('POST', '/api/portal/pay', {
      amountAgorot: 1000,
      idempotencyKey: bPayKey,
      cardId: bCard,
    });
    expect(replay.statusCode).toBe(404);
    // /me shows only family A.
    const me = (await p.req('GET', '/api/portal/me')).json();
    expect(me.students.map((s: { id: string }) => s.id).sort()).toEqual([A.s1, A.s2].sort());
    expect(me.receipts).toEqual([]);
    expect(me.cards).toEqual([]);
    // Nothing was written for family B (the PDF route is read-only and counts no output).
    expect(await ctx.deps.db.savedCard.count({ where: { studentId: B.studentId } })).toBe(1);
    expect(await ctx.deps.db.parentRequest.count()).toBe(0);
    expect(await ctx.deps.db.auditLog.count()).toBe(before + 1); // only A's sign-in
    expect((await ctx.deps.db.receipt.findUniqueOrThrow({ where: { id: bReceipt } })).printCount).toBe(0);
  });
});

describe('portal: view, pay, add a card', () => {
  it('shows balance per child, last 6 lines and last 4 receipts', async () => {
    const f = await cohen();
    for (let i = 0; i < 5; i++)
      await pay(a, {
        familyId: f.familyId,
        amountAgorot: 10000,
        details: { method: 'transfer', bank: 'לאומי', reference: `${i}`, date: today() },
      });
    const me = (await (await parent()).req('GET', '/api/portal/me')).json();
    const total = me.students.reduce((x: number, s: { balanceAgorot: number }) => x + s.balanceAgorot, 0);
    expect(me.balanceAgorot).toBe(total);
    expect(me.recent).toHaveLength(6);
    expect(me.receipts).toHaveLength(4);
    expect(me.receipts[0].number).toBeGreaterThan(me.receipts[3].number);
  });

  it('pays by card with the demo allocation, issues a receipt and records the parent as the actor', async () => {
    const f = await cohen();
    const p = await parent();
    const me = (await p.req('GET', '/api/portal/me')).json();
    const r = await p.req('POST', '/api/portal/pay', {
      amountAgorot: me.balanceAgorot,
      idempotencyKey: key(),
      newCard: mockCard('4242', true),
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().receipt.number).toBeGreaterThanOrEqual(3001);
    const payment = await ctx.deps.db.payment.findFirstOrThrow({ where: { familyId: f.familyId } });
    expect(payment).toMatchObject({ source: 'portal', method: 'card', createdById: null });
    const after = (await p.req('GET', '/api/portal/me')).json();
    expect(after.balanceAgorot).toBe(0);
    expect(after.cards).toHaveLength(1);
    const audit = await ctx.deps.db.auditLog.findFirstOrThrow({ where: { action: 'payment.create' } });
    expect(audit).toMatchObject({ actorType: 'parent', actorName: 'הורה: דוד כהן' });
    // No balance → nothing to pay.
    const none = await p.req('POST', '/api/portal/pay', {
      amountAgorot: 100,
      idempotencyKey: key(),
      cardId: after.cards[0].id,
    });
    expect(none.statusCode).toBe(400);
    // The parent can open their own receipt.
    const pdf = await p.req('GET', `/api/portal/receipts/${r.json().receipt.id}/pdf`);
    expect(pdf.headers['content-type']).toBe('application/pdf');
  });

  it('rejects a card number sent to the portal and a declined card', async () => {
    await cohen();
    const p = await parent();
    const pan = await p.req('POST', '/api/portal/requests', {
      type: 'contact',
      phone: '050-3333333',
      email: '4111111111111111',
    });
    expect(pan.json().error.code).toBe('card_number_rejected');
    const declined = await p.req('POST', '/api/portal/pay', {
      amountAgorot: 1000,
      idempotencyKey: key(),
      newCard: mockCard('0002'),
    });
    expect(declined.statusCode).toBe(402);
  });

  it("adds a card without paying, for one of the family's children", async () => {
    const f = await cohen();
    const p = await parent();
    const { save: _s, ...c } = mockCard('7777');
    const r = await p.req('POST', '/api/portal/cards', { studentId: f.s2, card: c });
    expect(r.statusCode, r.body).toBe(200);
    expect(await ctx.deps.db.savedCard.count({ where: { studentId: f.s2 } })).toBe(1);
  });
});

describe('parent requests and their approval (demo reqApprove, C11, C12)', () => {
  it('installments: approved per child with a debt, first payment in 30 days, consent from the portal', async () => {
    const f = await cohen();
    const p = await parent();
    const r = await p.req('POST', '/api/portal/requests', {
      type: 'installments',
      months: 6,
      method: 'card',
      note: 'נבקש לפרוס',
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(
      (await p.req('POST', '/api/portal/requests', { type: 'installments', months: 3, method: 'transfer' }))
        .statusCode,
    ).toBe(409);

    const list = (await a.req('GET', '/api/requests')).json().requests;
    expect(list[0]).toMatchObject({
      type: 'installments',
      status: 'pending',
      detailsText: '6 חודשים · כרטיס',
      note: 'נבקש לפרוס',
      studentsLabel: 'יוסף כהן, שרה כהן',
    });
    expect((await a.req('GET', '/api/alerts')).json().alerts.map((x: { text: string }) => x.text)).toContain(
      '1 בקשות הורים ממתינות לטיפול',
    );

    const form = (await a.req('GET', `/api/requests/${r.json().id}/approval`)).json();
    expect(form.installments.startDate).toBe('2026-11-13');
    expect(form.installments.count).toBe(6);
    // No saved card → the demo falls back to transfer.
    expect(form.installments.students.map((s: { method: string }) => s.method)).toEqual([
      'transfer',
      'transfer',
    ]);

    // C11: send the parent a link to add a card.
    expect((await a.req('POST', `/api/requests/${r.json().id}/card-link`)).statusCode).toBe(200);
    expect(await lastText('0501111111')).toMatch(
      /יש להוסיף כרטיס בפורטל ההורים: http:\/\/localhost:5173\/portal\?t=/,
    );

    const ok = await a.req('POST', `/api/requests/${r.json().id}/approve`, {
      plans: form.installments.students.map((s: { studentId: string }) => ({
        studentId: s.studentId,
        count: 6,
        startDate: form.installments.startDate,
        method: 'transfer',
      })),
    });
    expect(ok.statusCode, ok.body).toBe(200);
    const plans = await ctx.deps.db.billingPlan.findMany({
      include: { charges: true },
      orderBy: { createdAt: 'asc' },
    });
    expect(plans).toHaveLength(2);
    expect(plans[0]).toMatchObject({
      type: 'installments',
      count: 6,
      startDate: '2026-11-13',
      consentMethod: 'בפורטל ההורים',
    });
    expect(plans[0]!.charges).toHaveLength(6);
    expect(plans.map((x) => x.amountAgorot)).toEqual(
      form.installments.students.map((s: { balanceAgorot: number }) => s.balanceAgorot),
    );
    const after = (await a.req('GET', '/api/requests')).json().requests[0];
    expect(after.status).toBe('approved');
    expect(after.resultSummary).toContain('פריסה ליוסף כהן: 6 תשלומים');
    expect((await a.req('POST', `/api/requests/${r.json().id}/approve`, { plans: [] })).statusCode).toBe(400);
    expect((await a.req('POST', `/api/requests/${r.json().id}/reject`, { reason: 'x' })).statusCode).toBe(
      409,
    );
    // The parent sees the outcome.
    expect((await p.req('GET', '/api/portal/me')).json().requests[0]).toMatchObject({ status: 'approved' });
    void f;
  });

  it('installments: refuses a student of another family and a request without a balance', async () => {
    await cohen();
    const other = await newFamily(a, 'משה לוי', 'רחל לוי', '050-2222222');
    const p = await parent();
    const r = (
      await p.req('POST', '/api/portal/requests', { type: 'installments', months: 3, method: 'transfer' })
    ).json();
    const bad = await a.req('POST', `/api/requests/${r.id}/approve`, {
      plans: [{ studentId: other.studentId, count: 3, startDate: '2026-11-13', method: 'transfer' }],
    });
    expect(bad.statusCode).toBe(400);
    expect(await ctx.deps.db.billingPlan.count()).toBe(0);
    const zero = await newFamily(a, 'נעם רז', 'דנה רז', '050-4444444');
    await pay(a, {
      familyId: zero.familyId,
      amountAgorot: 960000,
      details: { method: 'transfer', bank: 'לאומי', reference: '1', date: today() },
    });
    const pz = await parent('050-4444444');
    expect(
      (await pz.req('POST', '/api/portal/requests', { type: 'installments', months: 3, method: 'transfer' }))
        .statusCode,
    ).toBe(400);
  });

  it('discount for all the children: the form is prefilled per child and approval adds the discounts', async () => {
    const f = await cohen();
    const p = await parent();
    const r = (
      await p.req('POST', '/api/portal/requests', {
        type: 'discount',
        pct: 10,
        studentId: null,
        note: 'מצב כלכלי',
      })
    ).json();
    const form = (await a.req('GET', `/api/requests/${r.id}/approval`)).json();
    expect(
      form.discount.students.map((s: { studentId: string; pct: number }) => [s.studentId, s.pct]),
    ).toEqual([
      [f.s1, 10],
      [f.s2, 10],
    ]);
    const ok = await a.req('POST', `/api/requests/${r.id}/approve`, {
      discounts: form.discount.students.map((s: { studentId: string }) => ({
        studentId: s.studentId,
        kind: 'pct',
        value: 10,
        reason: 'צורך משפחתי',
      })),
    });
    expect(ok.statusCode, ok.body).toBe(200);
    const discs = await ctx.deps.db.charge.findMany({ where: { type: 'disc' } });
    expect(discs.map((d) => d.amountAgorot)).toEqual([-96000, -96000]);
  });

  it('discount for one child cannot be applied to a sibling', async () => {
    const f = await cohen();
    const p = await parent();
    const r = (
      await p.req('POST', '/api/portal/requests', { type: 'discount', pct: 5, studentId: f.s1 })
    ).json();
    const bad = await a.req('POST', `/api/requests/${r.id}/approve`, {
      discounts: [{ studentId: f.s2, kind: 'pct', value: 5, reason: 'אחר' }],
    });
    expect(bad.statusCode).toBe(400);
  });

  it('contact update is applied on approval; rejection needs a reason that is sent to the parent', async () => {
    const f = await cohen();
    const p = await parent();
    const c = (
      await p.req('POST', '/api/portal/requests', {
        type: 'contact',
        phone: '052-7777777',
        email: 'new@example.com',
      })
    ).json();
    const form = (await a.req('GET', `/api/requests/${c.id}/approval`)).json();
    expect(form.contact).toEqual({
      current: { phone: '050-1111111', email: '' },
      requested: { phone: '052-7777777', email: 'new@example.com' },
    });
    expect((await a.req('POST', `/api/requests/${c.id}/approve`, {})).statusCode).toBe(200);
    expect(await ctx.deps.db.family.findUniqueOrThrow({ where: { id: f.familyId } })).toMatchObject({
      phone: '052-7777777',
      phoneNorm: '0527777777',
      email: 'new@example.com',
    });

    const d = (
      await p.req('POST', '/api/portal/requests', { type: 'discount', pct: 50, studentId: null })
    ).json();
    expect((await a.req('POST', `/api/requests/${d.id}/reject`, { reason: '' })).statusCode).toBe(400);
    expect(
      (await a.req('POST', `/api/requests/${d.id}/reject`, { reason: 'לא עומד בקריטריונים' })).statusCode,
    ).toBe(200);
    // Email first when the family has one (stage 9); SMS only for a family without email.
    const mail = await ctx.deps.db.outbox.findFirstOrThrow({
      where: { to: 'new@example.com' },
      orderBy: { createdAt: 'desc' },
    });
    expect(mail.text).toBe('בקשת ההנחה שלך נדחתה. סיבה: לא עומד בקריטריונים');
    const mine = (await p.req('GET', '/api/portal/me')).json().requests[0];
    expect(mine).toMatchObject({ status: 'rejected', rejectReason: 'לא עומד בקריטריונים' });
    const actions = (await ctx.deps.db.auditLog.findMany()).map((x) => x.action);
    expect(actions).toEqual(
      expect.arrayContaining(['request.create', 'request.approve', 'request.reject', 'family.update']),
    );
  });

  it('a decided request cannot be changed or deleted in the database', async () => {
    await cohen();
    const p = await parent();
    const r = (await p.req('POST', '/api/portal/requests', { type: 'contact', phone: '052-7777777' })).json();
    await a.req('POST', `/api/requests/${r.id}/reject`, { reason: 'לא' });
    await expect(
      ctx.deps.db.parentRequest.update({ where: { id: r.id }, data: { status: 'pending' } }),
    ).rejects.toThrow();
    await expect(ctx.deps.db.parentRequest.delete({ where: { id: r.id } })).rejects.toThrow();
  });
});

describe('staff portal preview (decision B8)', () => {
  it('shows the family as the parent sees it, read only, with the req permission', async () => {
    const f = await cohen();
    const v = (await a.req('GET', `/api/portal-preview/${f.familyId}`)).json();
    expect(v).toMatchObject({ readOnly: true, parentName: 'דוד כהן' });
    expect(v.csrfToken).toBeUndefined();
    const fams = (await a.req('GET', '/api/portal-preview/families')).json().families;
    expect(fams.map((x: { id: string }) => x.id)).toContain(f.familyId);
  });
});
