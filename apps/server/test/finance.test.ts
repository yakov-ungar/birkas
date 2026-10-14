import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeApp, signedIn, type TestCtx, type Agent } from './helpers';
import { addStudent, card, cash, key, mockCard, newFamily, openCash, pay } from './finance-helpers';

let ctx: TestCtx;
let a: Agent;
beforeEach(async () => {
  ctx = await makeApp();
  a = (await signedIn(ctx)).agent;
  await openCash(a);
});
afterEach(() => ctx.close());

describe('students, families and sibling discount', () => {
  it('creates a family from the student name and charges tuition', async () => {
    const { studentId, familyId } = await newFamily(a);
    const c = await card(a, studentId);
    expect(c.family.name).toBe('משפחת כהן');
    expect(c.balanceAgorot).toBe(960000);
    expect(c.ledger[0].description).toBe('שכר לימוד תשפ״ז');
    const fam = (await a.req('GET', `/api/families/${familyId}`)).json();
    expect(fam.students).toHaveLength(1);
  });

  it('applies 10% to the second child and 20% to the third, and recalculates on status change', async () => {
    const first = await newFamily(a);
    const second = await addStudent(a, { fullName: 'אפרים כהן', familyId: first.familyId });
    expect(second.siblingDiscountAgorot).toBe(96000);
    const third = await addStudent(a, { fullName: 'מנחם כהן', familyId: first.familyId });
    expect(third.siblingDiscountAgorot).toBe(192000);

    // First child leaves: second becomes first (0%), third becomes second (10%).
    await a.req('POST', `/api/students/${first.studentId}/status`, { status: 'left' });
    expect((await card(a, second.studentId)).balanceAgorot).toBe(960000);
    expect((await card(a, third.studentId)).balanceAgorot).toBe(960000 - 96000);

    // Nothing was deleted: old discounts were reversed.
    const sib = await ctx.deps.db.charge.findMany({ where: { type: 'sib' } });
    expect(sib.filter((c) => c.reversalOfId).length).toBeGreaterThanOrEqual(2);
    const total = sib.reduce((s, c) => s + c.amountAgorot, 0);
    expect(total).toBe(-96000);
  });

  it('lists students with the demo filters', async () => {
    const f = await newFamily(a);
    await addStudent(a, {
      fullName: 'שמואל גולד',
      grade: "ד'",
      newFamily: { parentName: 'יעקב גולד', phone: '050-4444444' },
    });
    await pay(a, { studentId: f.studentId, amountAgorot: 960000, details: cash });
    const all = (await a.req('GET', '/api/students?filter=act')).json().students;
    expect(all).toHaveLength(2);
    expect(all.find((s: { id: string }) => s.id === f.studentId).payStatus).toBe('paid');
    expect((await a.req('GET', '/api/students?filter=debt')).json().students).toHaveLength(1);
    expect(
      (await a.req('GET', `/api/students?grade=${encodeURIComponent("ד'")}`)).json().students,
    ).toHaveLength(1);
    expect(
      (await a.req('GET', `/api/students?q=${encodeURIComponent('4444')}`)).json().students[0].fullName,
    ).toBe('שמואל גולד');
  });

  it('only deletes a student without financial history, by reversing charges', async () => {
    const f = await newFamily(a);
    expect((await a.req('POST', `/api/students/${f.studentId}/delete`)).statusCode).toBe(200);
    expect((await a.req('GET', `/api/students/${f.studentId}`)).statusCode).toBe(404);
    expect(await ctx.deps.db.charge.count()).toBe(2); // tuition + reversal

    const g = await newFamily(a, 'אברהם לוי', 'משה לוי', '052-2222222');
    await pay(a, { studentId: g.studentId, amountAgorot: 1000, details: cash });
    const r = await a.req('POST', `/api/students/${g.studentId}/delete`);
    expect(r.statusCode).toBe(409);
  });

  it('edits family details and keeps an audit trail', async () => {
    const f = await newFamily(a);
    const r = await a.req('PATCH', `/api/families/${f.familyId}`, {
      parentName: 'דוד כהן',
      phone: '052-9998877',
      email: 'cohen@example.com',
    });
    expect(r.statusCode).toBe(200);
    const log = await ctx.deps.db.auditLog.findFirstOrThrow({ where: { action: 'family.update' } });
    expect(JSON.parse(log.before!).phone).toBe('050-1111111');
    expect(JSON.parse(log.after!).phone).toBe('052-9998877');
  });
});

describe('charges and discounts', () => {
  it('adds a single charge and cancels it with a reversal', async () => {
    const f = await newFamily(a);
    const c = await a.req('POST', '/api/charges', {
      studentId: f.studentId,
      type: 'trip',
      description: 'טיול שנתי',
      amountAgorot: 12000,
      date: '2026-10-01',
    });
    const id = c.json().chargeId;
    expect((await card(a, f.studentId)).balanceAgorot).toBe(972000);
    expect((await a.req('POST', `/api/charges/${id}/cancel`, { reason: 'נרשם בטעות' })).statusCode).toBe(200);
    expect((await a.req('POST', `/api/charges/${id}/cancel`, { reason: 'שוב' })).statusCode).toBe(409);
    expect((await card(a, f.studentId)).balanceAgorot).toBe(960000);
    await expect(ctx.deps.db.$executeRawUnsafe(`DELETE FROM "Charge" WHERE id = '${id}'`)).rejects.toThrow(
      /append-only/,
    );
    await expect(
      ctx.deps.db.$executeRawUnsafe(`UPDATE "Charge" SET "amountAgorot" = 1 WHERE id = '${id}'`),
    ).rejects.toThrow(/append-only/);
  });

  it('refuses to cancel an automatic sibling discount', async () => {
    const f = await newFamily(a);
    await addStudent(a, { fullName: 'אפרים כהן', familyId: f.familyId });
    const sib = await ctx.deps.db.charge.findFirstOrThrow({ where: { type: 'sib' } });
    expect((await a.req('POST', `/api/charges/${sib.id}/cancel`, { reason: 'x' })).statusCode).toBe(409);
  });

  it('bulk-charges a grade after a matching preview', async () => {
    await newFamily(a);
    await addStudent(a, {
      fullName: 'שמואל גולד',
      grade: "ד'",
      newFamily: { parentName: 'יעקב גולד', phone: '050-4444444' },
    });
    const body = { catalogItemId: 'cat_trip', grade: "א'", date: '2026-10-01' };
    const pv = (await a.req('POST', '/api/charges/bulk/preview', body)).json();
    expect(pv).toMatchObject({ description: 'טיול שנתי', amountAgorot: 12000, count: 1, totalAgorot: 12000 });
    expect((await a.req('POST', '/api/charges/bulk', { ...body, expectedCount: 2 })).statusCode).toBe(409);
    expect((await a.req('POST', '/api/charges/bulk', { ...body, expectedCount: 1 })).json().count).toBe(1);
  });

  it('gives a percent or fixed discount capped at tuition, keeping the internal note private', async () => {
    const f = await newFamily(a);
    const pct = await a.req('POST', '/api/charges/discount', {
      studentId: f.studentId,
      kind: 'pct',
      value: 15,
      reason: 'מלגה',
      note: 'מצב רפואי',
    });
    expect(pct.json().amountAgorot).toBe(144000);
    const row = await ctx.deps.db.charge.findUniqueOrThrow({ where: { id: pct.json().chargeId } });
    expect(row.description).toBe('מלגה (15%)');
    expect(row.internalNote).toBe('מצב רפואי');
    const over = await a.req('POST', '/api/charges/discount', {
      studentId: f.studentId,
      kind: 'amount',
      value: 2_000_000,
      reason: 'אחר',
    });
    expect(over.statusCode).toBe(400);
    expect(over.json().error.message).toBe('ההנחה גדולה משכר הלימוד');
    expect(
      (
        await a.req('POST', '/api/charges/discount', {
          studentId: f.studentId,
          kind: 'pct',
          value: 101,
          reason: 'אחר',
        })
      ).statusCode,
    ).toBe(400);
  });

  it('manages the catalog (5 demo items, add, remove)', async () => {
    expect((await a.req('GET', '/api/catalog')).json().items).toHaveLength(5);
    const add = await a.req('POST', '/api/catalog', { name: 'חוג', defaultAgorot: 5000, type: 'other' });
    await a.req('POST', `/api/catalog/${add.json().item.id}/remove`);
    expect((await a.req('GET', '/api/catalog')).json().items).toHaveLength(5);
  });
});

describe('payments and receipts', () => {
  it('allocates a family payment to the largest debt first, with consecutive receipt numbers', async () => {
    const f = await newFamily(a);
    const b = await addStudent(a, { fullName: 'אפרים כהן', familyId: f.familyId }); // 8640 after 10%
    const r1 = await pay(a, { familyId: f.familyId, amountAgorot: 1_000_000, details: cash });
    expect(r1.statusCode).toBe(200);
    const res = r1.json();
    expect(res.receipt.number).toBe(3001);
    expect(res.allocations).toEqual([
      expect.objectContaining({ studentId: f.studentId, amountAgorot: 960000 }),
      expect.objectContaining({ studentId: b.studentId, amountAgorot: 40000 }),
    ]);
    const r2 = await pay(a, {
      studentId: b.studentId,
      amountAgorot: 5000,
      details: { method: 'transfer', bank: 'לאומי', reference: '12345', date: '2026-10-10' },
    });
    expect(r2.json().receipt.number).toBe(3002);
    expect(r2.json().receipt.reference).toBe('לאומי · 12345');
  });

  it('accepts a manual allocation only when it adds up', async () => {
    const f = await newFamily(a);
    const b = await addStudent(a, { fullName: 'אפרים כהן', familyId: f.familyId });
    const bad = await pay(a, {
      familyId: f.familyId,
      amountAgorot: 1000,
      allocations: [{ studentId: f.studentId, amountAgorot: 500 }],
      details: cash,
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.message).toBe('סכום החלוקה חייב להיות שווה לסכום התשלום');
    const ok = await pay(a, {
      familyId: f.familyId,
      amountAgorot: 1000,
      allocations: [
        { studentId: f.studentId, amountAgorot: 300 },
        { studentId: b.studentId, amountAgorot: 700 },
      ],
      details: cash,
    });
    expect(ok.json().allocations.map((x: { amountAgorot: number }) => x.amountAgorot)).toEqual([300, 700]);
  });

  it('is idempotent: the same submission twice creates one payment and one receipt', async () => {
    const f = await newFamily(a);
    const k = key();
    const [x, y] = await Promise.all([
      a.req('POST', '/api/payments', {
        idempotencyKey: k,
        studentId: f.studentId,
        amountAgorot: 1000,
        details: cash,
      }),
      a.req('POST', '/api/payments', {
        idempotencyKey: k,
        studentId: f.studentId,
        amountAgorot: 1000,
        details: cash,
      }),
    ]);
    const ok = [x, y].filter((r) => r.statusCode === 200);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    expect(await ctx.deps.db.payment.count()).toBe(1);
    expect(await ctx.deps.db.receipt.count()).toBe(1);
    const again = await a.req('POST', '/api/payments', {
      idempotencyKey: k,
      studentId: f.studentId,
      amountAgorot: 1000,
      details: cash,
    });
    expect(again.json().receipt.number).toBe(3001);
  });

  it(
    'keeps receipt numbers gap-free and unique under 1000 concurrent payments',
    { timeout: 180_000 },
    async () => {
      const f = await newFamily(a);
      const n = 1000;
      const results = await Promise.all(
        Array.from({ length: n }, () => pay(a, { studentId: f.studentId, amountAgorot: 100, details: cash })),
      );
      const bad = results.filter((r) => r.statusCode !== 200);
      expect(bad.map((r) => `${r.statusCode} ${r.body}`).slice(0, 3)).toEqual([]);
      const nums = (await ctx.deps.db.receipt.findMany({ select: { number: true } }))
        .map((r) => r.number)
        .sort((x, y) => x - y);
      expect(nums).toEqual(Array.from({ length: n }, (_, i) => 3001 + i));
    },
  );

  it('charges a new card through the provider, saves it as a token only, and records the receipt', async () => {
    const f = await newFamily(a);
    const r = await pay(a, {
      studentId: f.studentId,
      amountAgorot: 50000,
      details: { method: 'card', newCard: mockCard('1111', true) },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().approvalCode).toMatch(/^\d{6}$/);
    expect(r.json().receipt.reference).toBe('כרטיס ****1111');
    const saved = await ctx.deps.db.savedCard.findFirstOrThrow();
    expect(saved).toMatchObject({ last4: '1111', isDefault: true, expMonth: 12, expYear: 2030 });
    expect(saved.tokenEnc).not.toContain('mock_tok_');
    const c = await card(a, f.studentId);
    expect(c.cards).toHaveLength(1);

    // Pay again with the saved card.
    const r2 = await pay(a, {
      studentId: f.studentId,
      amountAgorot: 1000,
      details: { method: 'card', cardId: saved.id },
    });
    expect(r2.json().receipt.reference).toBe('כרטיס שמור ****1111');
  });

  it('a declined card records the attempt and no payment', async () => {
    const f = await newFamily(a);
    const k = key();
    const r = await a.req('POST', '/api/payments', {
      idempotencyKey: k,
      studentId: f.studentId,
      amountAgorot: 1000,
      details: { method: 'card', newCard: mockCard('0002') },
    });
    expect(r.statusCode).toBe(402);
    expect(r.json().error.message).toBe('סירוב חברת האשראי');
    expect(await ctx.deps.db.payment.count()).toBe(0);
    expect((await ctx.deps.db.cardTransaction.findFirstOrThrow()).status).toBe('declined');
    // Retrying the same submission reports the same outcome without charging again.
    const again = await a.req('POST', '/api/payments', {
      idempotencyKey: k,
      studentId: f.studentId,
      amountAgorot: 1000,
      details: { method: 'card', newCard: mockCard('0002') },
    });
    expect(again.statusCode).toBe(402);
    expect(await ctx.deps.db.cardTransaction.count()).toBe(1);
  });

  it('refuses expired cards and saving cards without the cards permission', async () => {
    const f = await newFamily(a);
    const exp = await pay(a, {
      studentId: f.studentId,
      amountAgorot: 1000,
      details: { method: 'card', newCard: mockCard('1111', false, [1, 2020]) },
    });
    expect(exp.json().error.message).toBe('הכרטיס פג תוקף');
    const { agent: cashier } = await signedIn(ctx, ['stu_view', 'pay', 'checks', 'rec']);
    const r = await pay(cashier, {
      studentId: f.studentId,
      amountAgorot: 1000,
      details: { method: 'card', newCard: mockCard('1111', true) },
    });
    expect(r.statusCode).toBe(403);
  });

  it('rejects any request that carries a full card number', async () => {
    const f = await newFamily(a);
    const r = await pay(a, {
      studentId: f.studentId,
      amountAgorot: 1000,
      details: { method: 'cash', receivedBy: '4111 1111 1111 1111' },
    });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe('card_number_rejected');
    expect(await ctx.deps.db.payment.count()).toBe(0);
  });

  it('registers a check without touching the balance', async () => {
    const f = await newFamily(a);
    const r = await pay(a, {
      studentId: f.studentId,
      amountAgorot: 120000,
      details: { method: 'check', number: '123456', bank: 'פועלים 612', dueDate: '2026-11-01' },
    });
    expect(r.json().checkId).toBeTruthy();
    expect(r.json().receipt).toBeNull();
    expect((await card(a, f.studentId)).balanceAgorot).toBe(960000);
  });

  it('cancels a receipt with a credit note that has its own numbering and restores balances', async () => {
    const f = await newFamily(a);
    const p = (await pay(a, { studentId: f.studentId, amountAgorot: 100000, details: cash })).json();
    const r = await a.req('POST', `/api/receipts/${p.receipt.id}/cancel`, { reason: 'נרשם בטעות' });
    expect(r.statusCode).toBe(200);
    expect(r.json().receipt).toMatchObject({
      docType: 'credit_note',
      number: 1,
      creditForNumber: 3001,
      amountAgorot: 100000,
    });
    expect((await card(a, f.studentId)).balanceAgorot).toBe(960000);
    const orig = (await a.req('GET', `/api/receipts/${p.receipt.id}`)).json();
    expect(orig).toMatchObject({ cancelled: true, cancelledBy: 1, amountAgorot: 100000 });
    expect((await a.req('POST', `/api/receipts/${p.receipt.id}/cancel`, { reason: 'שוב' })).statusCode).toBe(
      409,
    );
    // The next receipt continues the receipt sequence.
    expect(
      (await pay(a, { studentId: f.studentId, amountAgorot: 100, details: cash })).json().receipt.number,
    ).toBe(3002);
    await expect(ctx.deps.db.$executeRawUnsafe(`UPDATE "Receipt" SET "amountAgorot" = 1`)).rejects.toThrow(
      /immutable/,
    );
    await expect(ctx.deps.db.$executeRawUnsafe(`DELETE FROM "Receipt"`)).rejects.toThrow(/append-only/);
    await expect(ctx.deps.db.$executeRawUnsafe(`DELETE FROM "Payment"`)).rejects.toThrow(/append-only/);
  });

  it('cancelling a card receipt refunds the card at the provider', async () => {
    const f = await newFamily(a);
    const p = (
      await pay(a, {
        studentId: f.studentId,
        amountAgorot: 5000,
        details: { method: 'card', newCard: mockCard() },
      })
    ).json();
    expect((await a.req('POST', `/api/receipts/${p.receipt.id}/cancel`, { reason: 'החזר' })).statusCode).toBe(
      200,
    );
    const refund = await ctx.deps.db.cardTransaction.findFirstOrThrow({ where: { kind: 'refund' } });
    expect(refund.status).toBe('approved');
  });

  it('refunds only an existing credit balance', async () => {
    const f = await newFamily(a);
    expect(
      (
        await a.req('POST', '/api/refunds', {
          idempotencyKey: key(),
          studentId: f.studentId,
          amountAgorot: 100,
          method: 'cash',
          reason: 'x',
        })
      ).statusCode,
    ).toBe(400);
    await pay(a, { studentId: f.studentId, amountAgorot: 1_000_000, details: cash }); // credit 400 ₪
    const over = await a.req('POST', '/api/refunds', {
      idempotencyKey: key(),
      studentId: f.studentId,
      amountAgorot: 50000,
      method: 'transfer',
      reason: 'x',
    });
    expect(over.statusCode).toBe(400);
    const ok = await a.req('POST', '/api/refunds', {
      idempotencyKey: key(),
      studentId: f.studentId,
      amountAgorot: 40000,
      method: 'transfer',
      reason: 'תשלום כפול',
    });
    expect(ok.json().receipt).toMatchObject({ docType: 'refund', number: 1 });
    expect((await card(a, f.studentId)).balanceAgorot).toBe(0);
  });

  it('marks the first PDF as original and later ones as copies, and emails automatically', async () => {
    const f = await newFamily(a, 'יוסף כהן', 'דוד כהן', '050-1111111', 'cohen@example.com');
    const p = (await pay(a, { studentId: f.studentId, amountAgorot: 1000, details: cash })).json();
    const mail = await ctx.deps.db.outbox.findFirstOrThrow({ where: { to: 'cohen@example.com' } });
    expect(JSON.parse(mail.attachmentNames!)).toEqual(['receipt-3001.pdf']);
    const r = await ctx.deps.db.receipt.findUniqueOrThrow({ where: { id: p.receipt.id } });
    expect(r.printCount).toBe(1);
    expect(r.sentTo).toBe('cohen@example.com');
    const pdf = await a.req('GET', `/api/receipts/${p.receipt.id}/pdf`);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await ctx.deps.db.receipt.findUniqueOrThrow({ where: { id: p.receipt.id } })).printCount).toBe(2);
  });
});

describe('statement, search and permissions inside the student card', () => {
  it('builds a family statement with a running balance, as JSON and PDF', async () => {
    const f = await newFamily(a);
    await addStudent(a, { fullName: 'אפרים כהן', familyId: f.familyId });
    await pay(a, { familyId: f.familyId, amountAgorot: 100000, details: cash });
    const s = (await a.req('GET', `/api/families/${f.familyId}/statement`)).json();
    expect(s.balanceAgorot).toBe(960000 + 960000 - 96000 - 100000);
    expect(s.ledger.at(-1).balanceAgorot).toBe(s.balanceAgorot);
    const pdf = await a.req('GET', `/api/families/${f.familyId}/statement/pdf`);
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(
      (await a.req('POST', `/api/families/${f.familyId}/statement/send`, { email: 'x@example.com' }))
        .statusCode,
    ).toBe(200);
  });

  it('searches students, parents, phones and receipt numbers', async () => {
    const f = await newFamily(a);
    await pay(a, { studentId: f.studentId, amountAgorot: 100, details: cash });
    const s = (await a.req('GET', `/api/search?q=${encodeURIComponent('דוד')}`)).json();
    expect(s.families[0].parentName).toBe('דוד כהן');
    expect(s.students[0].fullName).toBe('יוסף כהן');
    expect((await a.req('GET', '/api/search?q=0501111111')).json().families).toHaveLength(1);
    expect((await a.req('GET', '/api/search?q=3001')).json().receipts[0].number).toBe(3001);
    const { agent: viewer } = await signedIn(ctx, ['stu_view']);
    expect((await viewer.req('GET', '/api/search?q=3001')).json().receipts).toEqual([]);
  });

  it('hides saved cards in the student card without the cards permission', async () => {
    const f = await newFamily(a);
    await pay(a, {
      studentId: f.studentId,
      amountAgorot: 1000,
      details: { method: 'card', newCard: mockCard('1111', true) },
    });
    const { agent: viewer } = await signedIn(ctx, ['stu_view']);
    expect((await card(viewer, f.studentId)).cards).toBeNull();
    expect((await card(a, f.studentId)).cards).toHaveLength(1);
  });
});
