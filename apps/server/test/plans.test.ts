import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { israelDate } from '../src/lib/clock';
import { chargeInstallment, runDueCharges } from '../src/modules/plans/service';
import { schedulerTick } from '../src/modules/scheduler';
import { SYSTEM_ACTOR } from '../src/modules/audit/service';
import { makeApp, signedIn, type Agent, type TestCtx } from './helpers';
import { card, key, mockCard, newFamily } from './finance-helpers';

let ctx: TestCtx;
let a: Agent;
beforeEach(async () => {
  ctx = await makeApp();
  a = (await signedIn(ctx)).agent;
});
afterEach(() => ctx.close());

const today = () => israelDate(ctx.deps.clock.now());

async function saveCard(studentId: string, last4 = '1111', exp: [number, number] = [12, 2030]) {
  const { save: _s, ...c } = mockCard(last4, false, exp);
  const r = await a.req('POST', '/api/cards', { studentId, card: c });
  if (r.statusCode !== 200) throw new Error(r.body);
  return r.json().card.id as string;
}

async function createPlan(studentId: string, over: Record<string, unknown> = {}) {
  const plan = {
    studentId,
    type: 'installments',
    amountAgorot: 600000,
    count: 6,
    startDate: today(),
    method: 'card',
    ...over,
  };
  const r = await a.req('POST', '/api/plans', {
    plan,
    idempotencyKey: key(),
    ...(plan.method === 'transfer' ? {} : { consent: { method: 'phone', confirmed: true } }),
  });
  if (r.statusCode !== 200) throw new Error(`${r.statusCode} ${r.body}`);
  return r.json();
}

const run = () => runDueCharges(ctx.deps, { runKey: `t:${Math.random()}`, trigger: 'manual' });
const plan = async (id: string) => (await a.req('GET', `/api/plans/${id}`)).json();

describe('saved cards', () => {
  it('saves a card as a token, sets the first as default and blocks removal while a plan uses it', async () => {
    const f = await newFamily(a);
    const c1 = await saveCard(f.studentId);
    const c2 = await saveCard(f.studentId, '4444');
    let cards = (await a.req('GET', '/api/cards')).json().cards;
    expect(cards.map((c: { last4: string; isDefault: boolean }) => [c.last4, c.isDefault])).toEqual([
      ['1111', true],
      ['4444', false],
    ]);
    await createPlan(f.studentId, { cardId: c1 });
    const blocked = await a.req('POST', `/api/cards/${c1}/remove`);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.message).toContain('משויך לתוכנית חיוב פעילה');
    expect((await a.req('GET', '/api/cards')).json().cards[0].linkedPlans).toBe(1);

    await a.req('POST', `/api/cards/${c2}/default`);
    expect((await a.req('POST', `/api/cards/${c2}/remove`)).statusCode).toBe(200);
    cards = (await a.req('GET', '/api/cards')).json().cards;
    expect(cards.map((c: { last4: string; isDefault: boolean }) => [c.last4, c.isDefault])).toEqual([
      ['1111', true],
    ]);
  });

  it('refuses an expired card', async () => {
    const f = await newFamily(a);
    const { save: _s, ...c } = mockCard('1111', false, [1, 2020]);
    expect(
      (await a.req('POST', '/api/cards', { studentId: f.studentId, card: c })).json().error.message,
    ).toBe('הכרטיס פג תוקף');
  });
});

describe('billing plans', () => {
  it('previews the schedule and requires the payer consent for card plans', async () => {
    const f = await newFamily(a);
    const c = await saveCard(f.studentId);
    const pv = (
      await a.req('POST', '/api/plans/preview', {
        studentId: f.studentId,
        type: 'installments',
        amountAgorot: 1000050,
        count: 3,
        startDate: '2026-01-31',
        method: 'card',
        cardId: c,
      })
    ).json();
    expect(pv.schedule.map((x: { amountAgorot: number }) => x.amountAgorot)).toEqual([
      333300, 333300, 333450,
    ]);
    expect(pv.schedule.map((x: { dueDate: string }) => x.dueDate)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
    ]);
    expect(pv.consentText).toContain('דוד כהן אישר/ה חיוב כרטיס אשראי');
    const noConsent = await a.req('POST', '/api/plans', {
      plan: {
        studentId: f.studentId,
        type: 'installments',
        amountAgorot: 600000,
        count: 6,
        startDate: today(),
        method: 'card',
        cardId: c,
      },
      idempotencyKey: key(),
    });
    expect(noConsent.statusCode).toBe(400);
    const bad = await a.req('POST', '/api/plans/preview', {
      studentId: f.studentId,
      type: 'installments',
      amountAgorot: 600000,
      count: 40,
      startDate: today(),
      method: 'card',
      cardId: c,
    });
    expect(bad.json().error.fields.count).toBe('פריסה: בין 2 ל-36 תשלומים');
  });

  it('creating the same plan twice returns the first one', async () => {
    const f = await newFamily(a);
    const c = await saveCard(f.studentId);
    const body = {
      plan: {
        studentId: f.studentId,
        type: 'installments',
        amountAgorot: 600000,
        count: 6,
        startDate: today(),
        method: 'card',
        cardId: c,
      },
      idempotencyKey: key(),
      consent: { method: 'written', confirmed: true },
    };
    const [x, y] = [await a.req('POST', '/api/plans', body), await a.req('POST', '/api/plans', body)];
    expect(x.json().id).toBe(y.json().id);
    expect(await ctx.deps.db.billingPlan.count()).toBe(1);
    expect(x.json().consent.method).toBe('בכתב');
  });

  it('charges due installments, issues receipts, and a second run the same day charges nothing', async () => {
    const f = await newFamily(a);
    const c = await saveCard(f.studentId);
    const p = await createPlan(f.studentId, { cardId: c });
    const r1 = await runDueCharges(ctx.deps, { runKey: today(), trigger: 'schedule' });
    expect(r1).toMatchObject({ skipped: false, ok: 1, failed: 0 });
    const r2 = await runDueCharges(ctx.deps, { runKey: today(), trigger: 'schedule' });
    expect(r2.skipped).toBe(true);
    expect((await run()).ok).toBe(0); // a manual run finds nothing due either
    expect(await ctx.deps.db.payment.count()).toBe(1);
    const d = await plan(p.id);
    expect(d.charges[0].status).toBe('paid');
    expect(d.paidCount).toBe(1);
    const receipt = await ctx.deps.db.receipt.findFirstOrThrow();
    expect(receipt.reference).toBe('פריסה 1/6 ****1111');
    expect((await card(a, f.studentId)).balanceAgorot).toBe(960000 - 100000);

    // Next month the second installment is due.
    ctx.deps.clock.advance(31 * 86_400_000); // (the staff session times out; check the database directly)
    expect((await run()).ok).toBe(1);
    expect(await ctx.deps.db.planCharge.count({ where: { planId: p.id, status: 'paid' } })).toBe(2);
  });

  it('never pays an installment twice, even with concurrent runs', async () => {
    const f = await newFamily(a);
    const c = await saveCard(f.studentId);
    for (let i = 0; i < 3; i++) await createPlan(f.studentId, { cardId: c, amountAgorot: 30000, count: 3 });
    const results = await Promise.all([run(), run(), run(), a.req('POST', '/api/plans/run')]);
    const ok =
      results.slice(0, 3).reduce((s, r) => s + (r as { ok: number }).ok, 0) +
      (results[3] as { json: () => { ok: number } }).json().ok;
    expect(ok).toBe(3);
    expect(await ctx.deps.db.payment.count()).toBe(3);
    expect(await ctx.deps.db.cardTransaction.count()).toBe(3);
  });

  it('resumes an interrupted charge with the same provider key instead of charging again', async () => {
    const f = await newFamily(a);
    const c = await saveCard(f.studentId);
    const p = await createPlan(f.studentId, { cardId: c });
    const pc = p.charges[0];
    // Simulate a crash after the provider approved but before the payment was written.
    await ctx.deps.db.planCharge.update({
      where: { id: pc.id },
      data: { status: 'processing', attempts: 1, processingAt: new Date(Date.now() - 3_600_000) },
    });
    const token = 'mock_tok_1111_' + 'a'.repeat(16);
    const pre = await ctx.deps.payments.chargeToken({
      token,
      amountAgorot: pc.amountAgorot,
      idempotencyKey: `plan:${pc.id}:1`,
      description: '',
    });
    expect(pre.status).toBe('approved');
    await ctx.deps.db.cardTransaction.create({
      data: {
        idempotencyKey: `plan:${pc.id}:1`,
        kind: 'charge',
        familyId: f.familyId,
        amountAgorot: pc.amountAgorot,
        last4: '1111',
        status: 'pending',
        planChargeId: pc.id,
        cardId: c,
      },
    });
    expect((await run()).ok).toBe(1);
    const txns = await ctx.deps.db.cardTransaction.findMany();
    expect(txns).toHaveLength(1);
    expect(txns[0]!.providerTxnId).toBe((pre as { providerTxnId: string }).providerTxnId);
    expect(await ctx.deps.db.payment.count()).toBe(1);
  });

  it('records a decline, retries on request, and succeeds after swapping the card', async () => {
    const f = await newFamily(a);
    const bad = await saveCard(f.studentId, '0002');
    const good = await saveCard(f.studentId, '1111');
    const p = await createPlan(f.studentId, { cardId: bad });
    const r = await run();
    expect(r).toMatchObject({ ok: 0, failed: 1 });
    expect(r.failures[0]!.reason).toBe('סירוב חברת האשראי');
    let d = await plan(p.id);
    expect(d.display).toEqual(['נכשל חיוב', 'r']);
    expect(d.charges[0].lastError).toBe('סירוב חברת האשראי');

    const retry = await a.req('POST', `/api/plans/${p.id}/charges/${d.charges[0].id}/retry`);
    expect(retry.json().result).toBe('failed');
    await a.req('POST', `/api/plans/${p.id}/swap-card`, { cardId: good });
    const ok = await a.req('POST', `/api/plans/${p.id}/charges/${d.charges[0].id}/retry`);
    expect(ok.json().result).toBe('paid');
    d = ok.json().plan;
    expect(d.charges[0].status).toBe('paid');
    expect(await ctx.deps.db.cardTransaction.count({ where: { planChargeId: d.charges[0].id } })).toBe(3);
    expect(await ctx.deps.db.payment.count()).toBe(1);
  });

  it('fails without calling the provider when the card expired before the due date', async () => {
    const f = await newFamily(a);
    const [y, m] = today().split('-').map(Number) as [number, number];
    const c = await saveCard(f.studentId, '1111', [m, y]); // expires at the end of this month
    const p = await createPlan(f.studentId, { cardId: c, count: 2, amountAgorot: 20000 });
    expect((await run()).ok).toBe(1);
    ctx.deps.clock.advance(32 * 86_400_000);
    const r = await run();
    expect(r.failures[0]!.reason).toBe('הכרטיס פג תוקף');
    expect(await ctx.deps.db.cardTransaction.count()).toBe(1);
    void p;
  });

  it('skips paused plans and cancels the remaining installments', async () => {
    const f = await newFamily(a);
    const c = await saveCard(f.studentId);
    const p = await createPlan(f.studentId, { cardId: c });
    await a.req('POST', `/api/plans/${p.id}/pause`);
    expect((await run()).ok).toBe(0);
    expect((await plan(p.id)).display).toEqual(['מושבתת', 'o']);
    await a.req('POST', `/api/plans/${p.id}/resume`);
    expect((await run()).ok).toBe(1);
    const cancelled = await a.req('POST', `/api/plans/${p.id}/cancel`);
    expect(cancelled.json().display).toEqual(['בוטלה', 'gr']);
    expect(cancelled.json().charges.map((x: { status: string }) => x.status)).toEqual([
      'paid',
      'cancelled',
      'cancelled',
      'cancelled',
      'cancelled',
      'cancelled',
    ]);
    // The paid installment is final at the database level.
    await expect(
      ctx.deps.db.$executeRawUnsafe(`UPDATE "PlanCharge" SET "status" = 'pending' WHERE "status" = 'paid'`),
    ).rejects.toThrow(/final/);
  });

  it('transfer and standing-order plans wait for the bank instead of assuming payment', async () => {
    const f = await newFamily(a);
    await createPlan(f.studentId, { method: 'transfer' });
    const so = await createPlan(f.studentId, {
      method: 'standing_order',
      standingOrder: { bank: 'לאומי', branch: '800', account: '123456' },
    });
    expect(so.standingOrder).toEqual({ bank: 'לאומי', branch: '800', accountLast4: '3456' });
    const r = await run();
    expect(r).toMatchObject({ ok: 0, failed: 0, expected: 2 });
    expect(await ctx.deps.db.payment.count()).toBe(0);
    const stored = await ctx.deps.db.standingOrder.findFirstOrThrow();
    expect(stored.accountEnc).not.toContain('123456');
  });

  it('open-ended recurring plans keep 12 future charges', async () => {
    const f = await newFamily(a);
    const c = await saveCard(f.studentId);
    const p = await createPlan(f.studentId, { cardId: c, type: 'recurring', amountAgorot: 80000, count: 0 });
    expect(p.charges).toHaveLength(12);
    expect(p.label).toBe('חיוב חוזר חודשי (ללא הגבלה)');
    await run();
    const d = await plan(p.id);
    expect(d.charges).toHaveLength(13);
    expect(d.charges.filter((x: { status: string }) => x.status === 'pending')).toHaveLength(12);
  });

  it('shows plans inside the student card only with the plans permission', async () => {
    const f = await newFamily(a);
    const c = await saveCard(f.studentId);
    await createPlan(f.studentId, { cardId: c });
    expect((await card(a, f.studentId)).plans).toHaveLength(1);
    const { agent: viewer } = await signedIn(ctx, ['stu_view']);
    expect((await card(viewer, f.studentId)).plans).toBeNull();
  });
});

describe('nightly scheduler', () => {
  it('runs once after the configured time and emails admins about failures', async () => {
    await ctx.deps.db.setting.create({ data: { key: 'autoRunTime', value: '"00:00"' } });
    const f = await newFamily(a);
    const c = await saveCard(f.studentId, '0002');
    await createPlan(f.studentId, { cardId: c });
    const first = await schedulerTick(ctx.deps);
    expect(first.ran).toBe(true);
    expect((await schedulerTick(ctx.deps)).ran).toBe(false);
    expect(await ctx.deps.db.jobRun.count()).toBe(1);
    const mail = await ctx.deps.db.outbox.findFirstOrThrow({
      where: { subject: { contains: 'נכשלו בהרצה הלילית' } },
    });
    expect(mail.text).toContain('סירוב חברת האשראי');
  });

  it('does not run before the configured time', async () => {
    await ctx.deps.db.setting.create({ data: { key: 'autoRunTime', value: '"23:59"' } });
    const hh = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Jerusalem',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(ctx.deps.clock.now());
    if (hh >= '23:59') return; // the only minute this check cannot be made
    expect((await schedulerTick(ctx.deps)).ran).toBe(false);
  });
});

describe('alerts and dashboard', () => {
  it('lists failed and due charges and expiring cards, only for users who may open them', async () => {
    const f = await newFamily(a);
    const [y, m] = today().split('-').map(Number) as [number, number];
    const soon = await saveCard(f.studentId, '1111', [m, y]);
    const bad = await saveCard(f.studentId, '0002');
    await createPlan(f.studentId, { cardId: soon, count: 3, amountAgorot: 30000 });
    await createPlan(f.studentId, { cardId: bad, count: 3, amountAgorot: 30000 });
    await chargeInstallment(
      ctx.deps,
      (await ctx.deps.db.planCharge.findFirstOrThrow({ where: { plan: { cardId: bad }, seq: 1 } })).id,
      SYSTEM_ACTOR,
    );
    const alerts = (await a.req('GET', '/api/alerts')).json().alerts.map((x: { text: string }) => x.text);
    expect(alerts).toEqual(
      expect.arrayContaining(['1 חיובים נכשלו ודורשים טיפול', '1 חיובים הגיע מועדם ועדיין לא בוצעו']),
    );
    expect(alerts.some((t: string) => /כרטיס \*\*\*\*1111 .* יפוג בעוד \d+ ימים/.test(t))).toBe(true);
    const { agent: viewer } = await signedIn(ctx, ['stu_view']);
    expect((await viewer.req('GET', '/api/alerts')).json().alerts).toEqual([]);
  });

  it('summarizes collection on the dashboard', async () => {
    const f = await newFamily(a);
    await a.req('POST', '/api/payments', {
      idempotencyKey: key(),
      studentId: f.studentId,
      amountAgorot: 480000,
      details: { method: 'cash', receivedBy: 'x' },
    });
    const d = (await a.req('GET', '/api/dashboard')).json();
    expect(d.kpis).toMatchObject({
      netChargedAgorot: 960000,
      collectedAgorot: 480000,
      openAgorot: 480000,
      collectionPct: 50,
      activeStudents: 1,
    });
    expect(d.monthly).toHaveLength(6);
    expect(d.monthly.at(-1).amountAgorot).toBe(480000);
    expect(d.topDebtors[0]).toMatchObject({ name: 'משפחת כהן', balanceAgorot: 480000 });
    expect(d.activity.length).toBeGreaterThan(0);
  });
});
