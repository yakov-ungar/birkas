import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { REPORTS, type Report } from '@tuition/shared';
import { israelDate } from '../src/lib/clock';
import { Agent, makeApp, signedIn, type TestCtx } from './helpers';
import { addStudent, cash, key, mockCard, newFamily, openCash, pay } from './finance-helpers';

let ctx: TestCtx;
let a: Agent;
const il = (s: string) => new Date(`${s}+03:00`);
const today = () => israelDate(ctx.deps.clock.now());
const transfer = (date = today()) => ({ method: 'transfer', bank: 'לאומי', reference: '77', date });

beforeEach(async () => {
  ctx = await makeApp();
  ctx.deps.clock.set(il('2026-10-14T10:00:00'));
  a = (await signedIn(ctx)).agent;
});
afterEach(() => ctx.close());

const report = async (k: string, q = '') => {
  const r = await a.req('GET', `/api/reports/${k}${q}`);
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as Report;
};
const col = (r: Report, label: string) => r.columns.findIndex((c) => c.label === label);

/** Two families: Cohen with two kids (sibling discount), Levi with one. */
async function seed() {
  const c1 = await newFamily(a);
  const c2 = await addStudent(a, { fullName: 'שרה כהן', familyId: c1.familyId, grade: "ו'" });
  const l = await newFamily(a, 'משה לוי', 'רחל לוי', '050-2222222');
  return { cohen: c1.familyId, s1: c1.studentId, s2: c2.studentId, levi: l.familyId, s3: l.studentId };
}

describe('reports', () => {
  it('all ten reports answer with the demo columns, and need the rep permission', async () => {
    await seed();
    for (const k of Object.keys(REPORTS)) {
      const r = await report(k);
      expect(r.title).toBe(REPORTS[k as keyof typeof REPORTS]);
      expect(r.columns.length).toBeGreaterThan(1);
    }
    expect((await report('debt')).columns.map((c) => c.label)).toEqual([
      'תלמיד',
      'משפחה',
      'שוטף',
      '31-60',
      '61-90',
      '90+',
      'יתרה',
    ]);
    const { agent } = await signedIn(ctx, ['stu_view']);
    expect((await agent.req('GET', '/api/reports/debt')).statusCode).toBe(403);
    expect((await agent.req('GET', '/api/reports/debt/csv')).statusCode).toBe(403);
    expect((await a.req('GET', '/api/reports/nope')).statusCode).toBe(400);
  });

  it('accounting export total equals the money the ledger received in the period', async () => {
    const f = await seed();
    await openCash(a);
    const p1 = (
      await pay(a, {
        familyId: f.cohen,
        amountAgorot: 500000,
        details: { method: 'card', newCard: mockCard() },
      })
    ).json();
    await pay(a, { familyId: f.levi, amountAgorot: 120000, details: cash });
    await pay(a, { studentId: f.s3, amountAgorot: 30000, details: transfer() });
    // A cancelled receipt (credit note) and an overpayment refund.
    await a.req('POST', `/api/receipts/${p1.receipt.id}/cancel`, { reason: 'טעות' });
    await pay(a, { studentId: f.s3, amountAgorot: 1000000, details: transfer() });
    const refund = await a.req('POST', '/api/refunds', {
      studentId: f.s3,
      amountAgorot: 5000,
      method: 'transfer',
      reason: 'החזר יתרת זכות',
      idempotencyKey: key(),
    });
    expect(refund.statusCode, refund.body).toBe(200);
    // Outside the period.
    await pay(a, { familyId: f.levi, amountAgorot: 7000, details: transfer('2026-09-01') });

    const q = '?from=2026-10-01&to=2026-10-31';
    const acc = await report('accounting', q);
    const accTotal = acc.totals![col(acc, 'סכום')] as number;
    const payments = await ctx.deps.db.payment.aggregate({
      where: { date: { gte: '2026-10-01', lte: '2026-10-31' } },
      _sum: { amountAgorot: true },
    });
    expect(accTotal).toBe(payments._sum.amountAgorot);
    expect(accTotal).toBe(500000 - 500000 + 120000 + 30000 + 1000000 - 5000);

    // The same money seen in the "transactions by period" ledger: payment lines, credit minus debit.
    const led = await report('ledger', q);
    const pays = led.rows.filter((r) => String(r[col(led, 'תיאור')]).match(/^(תשלום|ביטול תשלום|החזר)/));
    const fromLedger = pays.reduce(
      (s, r) => s + Number(r[col(led, 'זכות')]) - Number(r[col(led, 'חובה')]),
      0,
    );
    expect(fromLedger).toBe(accTotal);
    expect(acc.rows.map((r) => r[0])).toEqual(expect.arrayContaining(['קבלה', 'אישור זיכוי', 'אישור החזר']));

    // By method and by month use the same payments.
    const methods = await report('methods', q);
    expect(methods.totals![1]).toBe(accTotal);
    const monthly = await report('monthly');
    expect(monthly.rows.map((r) => r[0])).toEqual(['09/2026', '10/2026']);
  });

  it('CSV opens in Hebrew Excel: BOM, CRLF, plain numbers, formula cells neutralized, and is audited', async () => {
    const f = await newFamily(a, '=HYPERLINK("x") ילד', 'הורה', '050-3333333');
    await pay(a, { studentId: f.studentId, amountAgorot: 123456, details: transfer() });
    const r = await a.req('GET', '/api/reports/ledger/csv?from=2026-10-01');
    expect(r.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(r.body.startsWith('﻿"תאריך","תלמיד"')).toBe(true);
    expect(r.body).toContain('\r\n');
    expect(r.body).toContain(`"'=HYPERLINK(""x"") ילד"`);
    expect(r.body).toContain('"1234.56"');
    expect(r.body).toContain('"14/10/2026"');
    const audit = await ctx.deps.db.auditLog.findFirstOrThrow({ where: { action: 'report.export' } });
    expect(audit.summary).toBe('יוצא דוח: תנועות לפי תקופה (2026-10-01)');
  });

  it('by grade: per school year (C16), payments cover the oldest year first', async () => {
    const f = await seed();
    // One year so far: grade א' has two students at 9,600 and ₪5,000 paid; the ו' child has the sibling discount.
    await pay(a, { studentId: f.s1, amountAgorot: 500000, details: transfer() });
    const g = await report('grades');
    expect(g.filters.year).toBe('תשפ״ז');
    const alef = g.rows.find((r) => r[0] === "א'")!;
    expect(alef).toEqual(["א'", 960000 * 2, 500000, 960000 * 2 - 500000, 26]);
    const vav = g.rows.find((r) => r[0] === "ו'")!;
    expect(vav[1]).toBe(864000); // second child: 10% sibling discount
  });

  it('date filters apply to dated reports and are validated', async () => {
    const f = await seed();
    await a.req('POST', '/api/charges/discount', { studentId: f.s3, kind: 'pct', value: 10, reason: 'מלגה' });
    expect((await report('discounts')).rows).toHaveLength(2); // the scholarship and the sibling discount
    expect((await report('discounts', '?to=2026-10-13')).rows).toHaveLength(0);
    expect((await a.req('GET', '/api/reports/discounts?from=2026-10-20&to=2026-10-01')).statusCode).toBe(400);
  });
});

describe('general settings', () => {
  it('changing the sibling percentages recalculates every family by reversal and new lines, never deleting', async () => {
    const f = await seed();
    const before = await ctx.deps.db.charge.findMany({ orderBy: { createdAt: 'asc' } });
    const s = (await a.req('GET', '/api/settings')).json().settings;
    const r = await a.req('PATCH', '/api/settings/general', {
      schoolName: s.schoolName,
      siblingPct: [0, 25, 30],
      checkReturnFeeAgorot: 5000,
      autoRunTime: '03:00',
      backupFrequency: 'weekly',
      grades: s.grades,
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().settings).toMatchObject({
      siblingPct: [0, 25, 30],
      autoRunTime: '03:00',
      checkReturnFeeAgorot: 5000,
    });
    const after = await ctx.deps.db.charge.findMany({ orderBy: { createdAt: 'asc' } });
    // Every old row is still there, unchanged.
    expect(after.slice(0, before.length)).toEqual(before);
    const sib = after.filter((c) => c.studentId === f.s2 && c.type === 'sib');
    expect(sib.map((c) => c.amountAgorot)).toEqual([-96000, 96000, -240000]);
    expect(sib[1]!.reversalOfId).toBe(sib[0]!.id);
    const bal = (await a.req('GET', `/api/families/${f.cohen}`)).json().balanceAgorot;
    expect(bal).toBe(960000 + 720000);
  });

  it('refuses to remove a grade that still has students, and checks percentages', async () => {
    await seed();
    const s = (await a.req('GET', '/api/settings')).json().settings;
    const base = {
      schoolName: s.schoolName,
      siblingPct: s.siblingPct,
      checkReturnFeeAgorot: 3000,
      autoRunTime: '02:00',
      backupFrequency: 'daily',
    };
    const r = await a.req('PATCH', '/api/settings/general', { ...base, grades: ["א'", "ב'"] });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.message).toContain("ו'");
    expect(
      (await a.req('PATCH', '/api/settings/general', { ...base, siblingPct: [0, 120, 20], grades: s.grades }))
        .statusCode,
    ).toBe(400);
    expect(
      (await a.req('PATCH', '/api/settings/general', { ...base, grades: [...s.grades, "ז'"] })).statusCode,
    ).toBe(200);
  });
});

describe('integrations (demo חיבורים)', () => {
  it('lists the six services, keeps credentials encrypted and out of every answer and the audit log', async () => {
    const list = (await a.req('GET', '/api/settings/integrations')).json().integrations;
    expect(list.map((i: { key: string }) => i.key)).toEqual([
      'card',
      'masav',
      'sms',
      'whatsapp',
      'email',
      'accounting',
    ]);
    expect(list.every((i: { connected: boolean }) => !i.connected)).toBe(true);

    const secret = 'Sup3r-Secret-Value-991';
    const live = await a.req('POST', '/api/settings/integrations/accounting', {
      username: 'school-sms',
      secret,
      mode: 'live',
    });
    expect(live.statusCode).toBe(400);
    const r = await a.req('POST', '/api/settings/integrations/accounting', {
      username: 'school-sms',
      secret,
      mode: 'test',
    });
    expect(r.statusCode).toBe(200);
    expect(r.body).not.toContain(secret);
    expect(r.json().integration).toMatchObject({
      connected: true,
      mode: 'test',
      details: 'משתמש sc***ms · מצב בדיקה',
    });
    const scan = (await new Agent(ctx.app).req('GET', `/api/test/scan?needle=${secret}`)).json();
    expect(scan.hits).toEqual([]);
    const row = await ctx.deps.db.integration.findUniqueOrThrow({ where: { key: 'accounting' } });
    expect(JSON.parse(ctx.deps.enc.decrypt(row.configEnc!))).toEqual({ username: 'school-sms', secret });
    expect(ctx.logs.join('')).not.toContain(secret);

    const t = (await a.req('POST', '/api/settings/integrations/card/test')).json();
    expect(t).toMatchObject({ ok: true });
    expect(t.messageHe).toContain('מצב בדיקה');
    expect(
      (await a.req('POST', '/api/settings/integrations/accounting/disconnect')).json().integration.connected,
    ).toBe(false);
    expect(
      (await ctx.deps.db.integration.findUniqueOrThrow({ where: { key: 'accounting' } })).configEnc,
    ).toBeNull();
    expect((await a.req('POST', '/api/settings/integrations/nope/test')).statusCode).toBe(400);
    await expect(ctx.deps.db.integration.delete({ where: { key: 'accounting' } })).rejects.toThrow();
  });
});

describe('opening a school year (demo newYear)', () => {
  const input = { yearName: 'תשפ״ח', tuitionAgorot: 990000, chargeDate: '2027-09-01' };

  it('the dry run changes nothing', async () => {
    const f = await seed();
    const snap = async () => ({
      charges: await ctx.deps.db.charge.findMany(),
      students: await ctx.deps.db.student.findMany(),
      settings: await ctx.deps.db.setting.findMany(),
      jobs: await ctx.deps.db.jobRun.count(),
      audit: await ctx.deps.db.auditLog.count(),
    });
    const before = await snap();
    const p = (await a.req('POST', '/api/settings/year/preview', input)).json();
    expect(p).toEqual({
      yearName: 'תשפ״ח',
      promoted: 2,
      graduating: 1,
      graduatingGrade: "ו'",
      newCharges: 2,
      totalAgorot: 1980000,
      siblingDiscountAgorot: 0,
      previousYear: 'תשפ״ז',
    });
    expect(await snap()).toEqual(before);
    void f;
  });

  it('promotes, graduates the last grade, charges the new tuition with sibling discounts, keeps balances, once', async () => {
    const f = await seed();
    const c3 = await addStudent(a, { fullName: 'דן כהן', familyId: f.cohen, grade: "ג'" });
    const bal = async (id: string) =>
      (await a.req('GET', `/api/families/${id}`)).json().balanceAgorot as number;
    const cohenBefore = await bal(f.cohen);
    const r = await a.req('POST', '/api/settings/year/open', input);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toEqual({ promoted: 3, graduated: 1, yearName: 'תשפ״ח' });
    const st = await ctx.deps.db.student.findMany({ orderBy: { enrollSeq: 'asc' } });
    expect(st.map((s) => [s.fullName, s.grade, s.status])).toEqual([
      ['יוסף כהן', "ב'", 'active'],
      ['שרה כהן', "ו'", 'graduated'],
      ['משה לוי', "ב'", 'active'],
      ['דן כהן', "ד'", 'active'],
    ]);
    const settings = (await a.req('GET', '/api/settings')).json().settings;
    expect(settings.activeYearName).toBe('תשפ״ח');
    // New year: Yosef pays full, Dan (now the second active child) gets 10%.
    const y = await ctx.deps.db.charge.findMany({ where: { yearName: 'תשפ״ח' } });
    expect(y.filter((c) => c.type === 'tuition').map((c) => c.amountAgorot)).toEqual([
      990000, 990000, 990000,
    ]);
    expect(
      y.filter((c) => c.type === 'sib' && c.studentId === c3.studentId).map((c) => c.amountAgorot),
    ).toEqual([-99000]);
    // The old year's lines are untouched and the old balance carries over.
    expect(await bal(f.cohen)).toBe(cohenBefore + 990000 * 2 - 99000);
    // Not twice, and not for the active year.
    expect((await a.req('POST', '/api/settings/year/open', input)).statusCode).toBe(400);
    expect((await a.req('POST', '/api/settings/year/open', { ...input, yearName: 'תשפ״ז' })).statusCode).toBe(
      400,
    );
    const info = (await a.req('GET', '/api/settings/year')).json();
    expect(info).toMatchObject({
      activeYearName: 'תשפ״ח',
      activeStudents: 3,
      graduated: 1,
      years: ['תשפ״ז', 'תשפ״ח'],
    });
    // The grade report can still show the previous year.
    expect((await report('grades', `?year=${encodeURIComponent('תשפ״ז')}`)).filters.year).toBe('תשפ״ז');
  });

  it('needs the settings permission', async () => {
    const { agent } = await signedIn(ctx, ['rep', 'stu_view']);
    expect((await agent.req('POST', '/api/settings/year/preview', input)).statusCode).toBe(403);
  });
});
