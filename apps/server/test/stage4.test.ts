import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { israelDate } from '../src/lib/clock';
import { runDueCharges } from '../src/modules/plans/service';
import { makeApp, signedIn, type Agent, type TestCtx } from './helpers';
import { addStudent, card, cash, key, newFamily, openCash, pay } from './finance-helpers';

let ctx: TestCtx;
let a: Agent;
beforeEach(async () => {
  ctx = await makeApp();
  a = (await signedIn(ctx)).agent;
});
afterEach(() => ctx.close());

const today = () => israelDate(ctx.deps.clock.now());
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);
const csv = (lines: string[]) => Buffer.from('﻿' + lines.join('\r\n'), 'utf8').toString('base64');
const register = (studentId: string, amountAgorot: number, dueDate: string, number = '123456') =>
  a.req('POST', '/api/checks', {
    idempotencyKey: key(),
    studentId,
    number,
    bank: 'פועלים 612',
    amountAgorot,
    dueDate,
  });

describe('postdated checks', () => {
  it('counts toward the balance only after deposit, which issues the receipt', async () => {
    const f = await newFamily(a);
    const c = (await register(f.studentId, 120000, today())).json();
    expect((await card(a, f.studentId)).balanceAgorot).toBe(960000);
    const d = await a.req('POST', `/api/checks/${c.id}/deposit`);
    expect(d.json().number).toBe(3001);
    expect((await card(a, f.studentId)).balanceAgorot).toBe(840000);
    expect((await a.req('POST', `/api/checks/${c.id}/deposit`)).statusCode).toBe(409);
    const rows = (await a.req('GET', '/api/checks')).json().checks;
    expect(rows[0]).toMatchObject({ status: 'deposited', receiptId: d.json().receiptId });
  });

  it('deposits only the checks whose date has arrived', async () => {
    const f = await newFamily(a);
    await register(f.studentId, 1000, addDays(today(), -2), '1');
    await register(f.studentId, 2000, today(), '2');
    await register(f.studentId, 3000, addDays(today(), 5), '3');
    expect((await a.req('POST', '/api/checks/deposit-due')).json()).toEqual({ count: 2, totalAgorot: 3000 });
    const statuses = (await a.req('GET', '/api/checks'))
      .json()
      .checks.map((c: { number: string; status: string }) => [c.number, c.status]);
    expect(statuses).toEqual([
      ['1', 'deposited'],
      ['2', 'deposited'],
      ['3', 'pending'],
    ]);
  });

  it('a returned check reverses the payment with a credit note and charges the fee', async () => {
    const f = await newFamily(a);
    const c = (await register(f.studentId, 50000, today())).json();
    await a.req('POST', `/api/checks/${c.id}/deposit`);
    const r = await a.req('POST', `/api/checks/${c.id}/return`);
    expect(r.json()).toEqual({ creditNoteNumber: 1, feeAgorot: 3000 });
    const s = await card(a, f.studentId);
    expect(s.balanceAgorot).toBe(960000 + 3000);
    expect(s.ledger.map((l: { description: string }) => l.description)).toEqual(
      expect.arrayContaining(['עמלת שיק חוזר 123456', 'ביטול תשלום שיק · שיק חוזר 123456 (אישור זיכוי 1)']),
    );
    const receipt = await ctx.deps.db.receipt.findFirstOrThrow({
      where: { docType: 'receipt' },
      include: { creditedBy: true },
    });
    expect(receipt.creditedBy?.number).toBe(1);
    expect((await a.req('POST', `/api/checks/${c.id}/return`)).statusCode).toBe(409);
  });

  it('cancels only a pending check and lists due checks in the alerts', async () => {
    const f = await newFamily(a);
    const late = (await register(f.studentId, 1000, addDays(today(), -3), '9')).json();
    await register(f.studentId, 1000, addDays(today(), 4), '8');
    const alerts = (await a.req('GET', '/api/alerts')).json().alerts.map((x: { text: string }) => x.text);
    expect(alerts).toEqual(
      expect.arrayContaining([
        '1 שיקים עבר מועד הפירעון שלהם ועדיין לא הופקדו',
        '1 שיקים לפירעון בשבוע הקרוב',
      ]),
    );
    expect((await a.req('POST', `/api/checks/${late.id}/cancel`)).statusCode).toBe(200);
    expect((await a.req('POST', `/api/checks/${late.id}/deposit`)).statusCode).toBe(409);
  });
});

describe('cash drawer', () => {
  it('refuses cash without an open drawer, and only one drawer can be open', async () => {
    const f = await newFamily(a);
    const r = await pay(a, { studentId: f.studentId, amountAgorot: 1000, details: cash });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('cash_closed');
    await openCash(a, 20000);
    expect((await a.req('POST', '/api/cash/open', { openingFloatAgorot: 0 })).statusCode).toBe(409);
    await expect(
      ctx.deps.db.cashSession.create({
        data: { openedAt: new Date(), openedById: 'x', openedByName: 'x', openingFloatAgorot: 0 },
      }),
    ).rejects.toThrow();
  });

  it('expects float + cash in - cash out, summarizes by method, and closes with a confirmed difference', async () => {
    const f = await newFamily(a);
    await openCash(a, 20000);
    await pay(a, { studentId: f.studentId, amountAgorot: 50000, details: cash });
    const second = (await pay(a, { studentId: f.studentId, amountAgorot: 10000, details: cash })).json();
    await pay(a, {
      studentId: f.studentId,
      amountAgorot: 7000,
      details: { method: 'transfer', bank: 'לאומי', reference: '1', date: today() },
    });
    await a.req('POST', `/api/receipts/${second.receipt.id}/cancel`, { reason: 'טעות' }); // cash goes back out
    const st = (await a.req('GET', '/api/cash')).json().open;
    expect(st).toMatchObject({
      openingFloatAgorot: 20000,
      cashInAgorot: 50000,
      expectedAgorot: 70000,
      transactions: 3,
    });
    expect(st.byMethod.find((m: { method: string }) => m.method === 'transfer').amountAgorot).toBe(7000);

    const short = await a.req('POST', '/api/cash/close', { countedAgorot: 69000 });
    expect(short.statusCode).toBe(409);
    expect(short.json().error.message).toContain('יש הפרש');
    const closed = await a.req('POST', '/api/cash/close', {
      countedAgorot: 69000,
      acceptDifference: true,
      notes: 'חסר 10',
    });
    expect(closed.json()).toEqual({ expectedAgorot: 70000, countedAgorot: 69000, diffAgorot: -1000 });
    const hist = (await a.req('GET', '/api/cash')).json();
    expect(hist.open).toBeNull();
    expect(hist.history[0]).toMatchObject({ diffAgorot: -1000, notes: 'חסר 10' });
    await expect(
      ctx.deps.db.$executeRawUnsafe(`UPDATE "CashSession" SET "countedAgorot" = 70000`),
    ).rejects.toThrow(/final/);
  });
});

describe('bank statement import', () => {
  const statement = (rows: string[]) =>
    csv(['דוח תנועות חשבון', 'תאריך,תיאור התנועה,אסמכתא,חובה,זכות,יתרה', ...rows]);

  it('imports credits only, matches by name and amount, and skips duplicates on re-import', async () => {
    const f = await newFamily(a); // דוד כהן, balance 9,600
    await newFamily(a, 'אברהם לוי', 'משה לוי', '052-2222222');
    const file = statement([
      '01/10/2026,העברה מדוד כהן,111,,"9,600.00",1',
      '02/10/2026,העברה ממשפחת לוי,112,,500.00,1',
      '03/10/2026,העברה 99882,113,,1000.00,1',
      '04/10/2026,עמלת ניהול חשבון,,15.00,,1',
    ]);
    const r = await a.req('POST', '/api/bank/import', { fileName: 'bank.csv', contentBase64: file });
    expect(r.json()).toEqual({ imported: 3, matched: 2, duplicates: 0, skipped: 1 });
    const tx = (await a.req('GET', '/api/bank/transactions')).json().transactions;
    const byRef = Object.fromEntries(tx.map((t: { reference: string }) => [t.reference, t]));
    expect(byRef['111']).toMatchObject({
      matchLevel: 'high',
      suggestedFamily: { id: f.familyId, name: 'משפחת כהן' },
    });
    expect(byRef['112']).toMatchObject({ matchLevel: 'medium', matchReason: 'שם המשפחה' });
    expect(byRef['113']).toMatchObject({ matchLevel: 'none', suggestedFamily: null });

    expect(
      (await a.req('POST', '/api/bank/import', { fileName: 'bank.csv', contentBase64: file })).statusCode,
    ).toBe(409);
    // An overlapping export (new file, same rows plus one) only adds the new row.
    const overlap = statement([
      '01/10/2026,העברה מדוד כהן,111,,"9,600.00",1',
      '05/10/2026,העברה מדוד כהן,114,,100.00,1',
    ]);
    expect(
      (await a.req('POST', '/api/bank/import', { fileName: 'bank2.csv', contentBase64: overlap })).json(),
    ).toMatchObject({ imported: 1, duplicates: 1 });

    // Confirm the suggestion: a receipt is issued and the transaction is closed.
    const reg = await a.req('POST', `/api/bank/transactions/${byRef['111'].id}/register`, {
      familyId: f.familyId,
    });
    expect(reg.json().receiptNumber).toBe(3001);
    expect((await card(a, f.studentId)).balanceAgorot).toBe(0);
    expect(
      (await a.req('POST', `/api/bank/transactions/${byRef['111'].id}/register`, { familyId: f.familyId }))
        .statusCode,
    ).toBe(409);
    expect((await a.req('POST', `/api/bank/transactions/${byRef['113'].id}/ignore`)).statusCode).toBe(200);
    const alerts = (await a.req('GET', '/api/alerts')).json().alerts.map((x: { text: string }) => x.text);
    expect(alerts).toContain('2 תנועות בנק ממתינות לאישור');
  });

  it('a matched transfer settles the waiting transfer-plan installment', async () => {
    const f = await newFamily(a);
    const plan = (
      await a.req('POST', '/api/plans', {
        plan: {
          studentId: f.studentId,
          type: 'installments',
          amountAgorot: 300000,
          count: 3,
          startDate: today(),
          method: 'transfer',
        },
        idempotencyKey: key(),
      })
    ).json();
    await runDueCharges(ctx.deps, { runKey: 'x', trigger: 'manual' });
    expect((await a.req('GET', `/api/plans/${plan.id}`)).json().charges[0].status).toBe('expected');
    await a.req('POST', '/api/bank/import', {
      fileName: 'b.csv',
      contentBase64: statement([`${today().split('-').reverse().join('/')},העברה בנקאית 5521,7,,1000.00,1`]),
    });
    const t = (await a.req('GET', '/api/bank/transactions')).json().transactions[0];
    expect(t).toMatchObject({ matchLevel: 'medium', matchReason: 'סכום של תשלום בתוכנית' });
    expect(
      (await a.req('POST', `/api/bank/transactions/${t.id}/register`, { familyId: f.familyId })).json()
        .planCharge,
    ).toBe(true);
    expect((await a.req('GET', `/api/plans/${plan.id}`)).json().charges[0].status).toBe('paid');
  });

  it('explains a file without the needed columns in Hebrew', async () => {
    const r = await a.req('POST', '/api/bank/import', {
      fileName: 'x.csv',
      contentBase64: csv(['שם,סכום', 'א,1']),
    });
    expect(r.json().error.message).toBe('לא נמצאה שורת כותרות עם עמודת "תאריך"');
  });
});

describe('standing orders and Masav', () => {
  async function standingOrderPlan(studentId: string) {
    const r = await a.req('POST', '/api/plans', {
      plan: {
        studentId,
        type: 'installments',
        amountAgorot: 200000,
        count: 2,
        startDate: today(),
        method: 'standing_order',
        standingOrder: { bank: '10', branch: '800', account: '1234567' },
      },
      idempotencyKey: key(),
      consent: { method: 'written', confirmed: true },
    });
    return r.json();
  }

  it('builds a file of due charges (marked demo only), settles it after the date, and handles a return', async () => {
    const f = await newFamily(a);
    const g = await addStudent(a, { fullName: 'אפרים כהן', familyId: f.familyId });
    const p1 = await standingOrderPlan(f.studentId);
    await standingOrderPlan(g.studentId);
    const so = (await a.req('GET', '/api/bank/standing-orders')).json().standingOrders;
    expect(so).toHaveLength(2);
    expect(so[0]).toMatchObject({ bank: '10', branch: '800', accountLast4: '4567' });
    expect(JSON.stringify(so)).not.toContain('1234567');

    const e = (await a.req('POST', '/api/bank/masav', { chargeDate: today() })).json();
    expect(e).toMatchObject({ count: 2, totalAgorot: 200000 });
    expect((await a.req('POST', '/api/bank/masav', { chargeDate: today() })).statusCode).toBe(400); // nothing left to send
    expect((await a.req('GET', `/api/plans/${p1.id}`)).json().charges[0].status).toBe('submitted');

    const file = await a.req('GET', `/api/bank/masav/${e.id}/file`);
    expect(file.body).toContain('קובץ הדגמה בלבד - לא לשליחה לבנק');
    expect(file.body).toContain('|10|800|1234567|100000|');
    const stored = await ctx.deps.db.masavExport.findUniqueOrThrow({ where: { id: e.id } });
    expect(stored.sha256).toHaveLength(64);

    // One order comes back before settlement; the other is paid on settlement.
    const exp = (await a.req('GET', '/api/bank/masav')).json().exports[0];
    const returned = exp.items.find((i: { studentName: string }) => i.studentName === 'אפרים כהן');
    expect(
      (await a.req('POST', `/api/bank/masav/items/${returned.id}/return`, { reason: 'אין כיסוי' }))
        .statusCode,
    ).toBe(200);
    const settle = await a.req('POST', `/api/bank/masav/${e.id}/settle`);
    expect(settle.json()).toEqual({ paid: 1 });
    expect((await a.req('POST', `/api/bank/masav/${e.id}/settle`)).statusCode).toBe(409);
    expect((await card(a, f.studentId)).balanceAgorot).toBe(960000 - 100000);
    const gPlan = (await a.req('GET', '/api/plans'))
      .json()
      .plans.find((x: { studentName: string }) => x.studentName === 'אפרים כהן');
    const gd = (await a.req('GET', `/api/plans/${gPlan.id}`)).json();
    expect(gd.charges[0]).toMatchObject({ status: 'failed', lastError: 'הוראת קבע הוחזרה: אין כיסוי' });

    // A return after settlement reverses the recorded payment; the installment is replaced, the count stays 2.
    const paidItem = exp.items.find((i: { studentName: string }) => i.studentName === 'יוסף כהן');
    expect(
      (await a.req('POST', `/api/bank/masav/items/${paidItem.id}/return`, { reason: 'ביטול הרשאה' }))
        .statusCode,
    ).toBe(200);
    expect((await card(a, f.studentId)).balanceAgorot).toBe(960000);
    const d1 = (await a.req('GET', `/api/plans/${p1.id}`)).json();
    expect(d1.label).toBe('פריסה ל-2 תשלומים');
    expect(d1.charges.map((c: { status: string }) => c.status)).toEqual(['returned', 'pending', 'failed']);
    expect(await ctx.deps.db.receipt.count({ where: { docType: 'credit_note' } })).toBe(1);
  });

  it('cannot settle before the charge date', async () => {
    const f = await newFamily(a);
    await standingOrderPlan(f.studentId);
    const e = (await a.req('POST', '/api/bank/masav', { chargeDate: addDays(today(), 40) })).json();
    expect(e.count).toBe(2);
    expect((await a.req('POST', `/api/bank/masav/${e.id}/settle`)).statusCode).toBe(409);
  });
});
