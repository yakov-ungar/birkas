import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { schedulerTick } from '../src/modules/scheduler';
import { documentPdf } from '../src/modules/receipts/service';
import { paidItems } from '../src/domain/ledger';
import { makeApp, signedIn, type Agent, type TestCtx } from './helpers';
import { newFamily, pay } from './finance-helpers';

let ctx: TestCtx;
let a: Agent;
const il = (s: string) => new Date(`${s}+03:00`);
/** Moves the clock and signs in again (a long jump idles the session out). */
async function at(when: string) {
  ctx.deps.clock.set(il(when));
  a = (await signedIn(ctx)).agent;
}
const transfer = (date: string) => ({ method: 'transfer', bank: 'לאומי', reference: '1', date });

beforeEach(async () => {
  ctx = await makeApp();
  await at('2026-10-14T10:00:00');
});
afterEach(() => ctx.close());

async function tutorAndLesson(studentId: string, price = 40000, start = '2026-10-10') {
  const tutor = (await a.req('POST', '/api/tutors', { name: 'הרב משה לוי', phone: '050-9999999' })).json();
  const r = await a.req('POST', '/api/tutoring', {
    studentId,
    tutorId: tutor.id,
    subject: 'גמרא',
    priceAgorot: price,
    startDate: start,
  });
  expect(r.statusCode, r.body).toBe(200);
  return { tutorId: tutor.id as string, lessonId: r.json().id as string };
}
const tutorCharges = () =>
  ctx.deps.db.charge.findMany({ where: { type: 'tutor' }, orderBy: { date: 'asc' } });

describe('private lessons with אברכים', () => {
  it('subjects come from settings; a lesson needs a listed subject and an active tutor', async () => {
    const f = await newFamily(a);
    const t = await a.req('GET', '/api/tutors');
    expect(t.json().subjects).toEqual(['גמרא', 'משנה', 'חומש', 'קריאה', 'חשבון', 'אנגלית']);
    const put = await a.req('PUT', '/api/settings/tutor-subjects', {
      tutorSubjects: ['גמרא', 'משניות', 'דקדוק'],
    });
    expect(put.json().tutorSubjects).toEqual(['גמרא', 'משניות', 'דקדוק']);
    const tutor = (await a.req('POST', '/api/tutors', { name: 'הרב כהן' })).json();
    const bad = await a.req('POST', '/api/tutoring', {
      studentId: f.studentId,
      tutorId: tutor.id,
      subject: 'אנגלית',
      priceAgorot: 30000,
      startDate: '2026-10-01',
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.message).toBe('המקצוע אינו ברשימה שבהגדרות');
    await a.req('PATCH', `/api/tutors/${tutor.id}`, { active: false });
    const inactive = await a.req('POST', '/api/tutoring', {
      studentId: f.studentId,
      tutorId: tutor.id,
      subject: 'גמרא',
      priceAgorot: 30000,
      startDate: '2026-10-01',
    });
    expect(inactive.statusCode).toBe(404);
    const { agent } = await signedIn(ctx, ['stu_view']);
    expect((await agent.req('POST', '/api/tutors', { name: 'x' })).statusCode).toBe(403);
  });

  it('charges the monthly price on the last day of the month, once, as a "שיעור פרטי" line', async () => {
    const f = await newFamily(a);
    await tutorAndLesson(f.studentId);
    // Before the month is over, nothing is charged, and a manual run is refused.
    await schedulerTick(ctx.deps);
    expect(await tutorCharges()).toEqual([]);
    expect((await a.req('POST', '/api/tutoring/run', { month: '2026-10' })).statusCode).toBe(400);

    await at('2026-10-31T03:00:00'); // last day, after the nightly run time (02:00)
    await schedulerTick(ctx.deps);
    await schedulerTick(ctx.deps);
    const charges = await tutorCharges();
    expect(charges).toHaveLength(1);
    expect(charges[0]).toMatchObject({
      type: 'tutor',
      amountAgorot: 40000,
      date: '2026-10-31',
      description: 'שיעור פרטי: גמרא · הרב משה לוי · 10/2026',
    });
    expect((await a.req('POST', '/api/tutoring/run', { month: '2026-10' })).json().charged).toBe(0);
    // The family balance includes it, and the statement shows it as its own line.
    const st = (await a.req('GET', `/api/families/${f.familyId}/statement`)).json();
    expect(st.ledger.map((l: { description: string }) => l.description)).toContain(
      'שיעור פרטי: גמרא · הרב משה לוי · 10/2026',
    );
    const lessons = (await a.req('GET', `/api/tutoring?studentId=${f.studentId}`)).json().lessons;
    expect(lessons[0].chargedMonths).toEqual(['2026-10']);
  });

  it('a month missed while the server was down is caught up early next month; an ended lesson stops', async () => {
    const f = await newFamily(a);
    const { lessonId } = await tutorAndLesson(f.studentId, 50000);
    await at('2026-11-02T03:00:00');
    await schedulerTick(ctx.deps); // catches up October
    expect((await tutorCharges()).map((c) => c.date)).toEqual(['2026-10-31']);
    // Ended mid-November: November is charged in full, December is not.
    expect((await a.req('POST', `/api/tutoring/${lessonId}/end`, { endDate: '2026-11-15' })).statusCode).toBe(
      200,
    );
    await at('2026-11-30T03:00:00');
    await schedulerTick(ctx.deps);
    await at('2026-12-31T03:00:00');
    await schedulerTick(ctx.deps);
    expect((await tutorCharges()).map((c) => c.date)).toEqual(['2026-10-31', '2026-11-30']);
  });

  it('a student who left is not charged', async () => {
    const f = await newFamily(a);
    await tutorAndLesson(f.studentId);
    const st = await a.req('POST', `/api/students/${f.studentId}/status`, { status: 'left' });
    expect(st.statusCode, st.body).toBe(200);
    await at('2026-10-31T03:00:00');
    await schedulerTick(ctx.deps);
    expect(await tutorCharges()).toEqual([]);
  });

  it('the receipt lists what the payment paid, with the lesson as its own item', async () => {
    const f = await newFamily(a);
    await tutorAndLesson(f.studentId);
    await at('2026-10-31T03:00:00');
    await schedulerTick(ctx.deps);
    // Tuition 9,600 (charged at enrolment) + lesson 400. An earlier payment covered 9,000 of the tuition.
    await pay(a, { studentId: f.studentId, amountAgorot: 900000, details: transfer('2026-10-31') });
    const r = (
      await pay(a, { studentId: f.studentId, amountAgorot: 110000, details: transfer('2026-10-31') })
    ).json();
    const view = (await a.req('GET', `/api/receipts/${r.receipt.id}`)).json();
    expect(view.lines[0].items).toEqual([
      { description: 'שכר לימוד תשפ״ז', amountAgorot: 60000 },
      { description: 'שיעור פרטי: גמרא · הרב משה לוי · 10/2026', amountAgorot: 40000 },
      { description: 'יתרת זכות (תשלום מראש)', amountAgorot: 10000 },
    ]);
    const { pdf } = await documentPdf(ctx.deps.db, r.receipt.id);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    // The breakdown is frozen on the receipt.
    await expect(
      ctx.deps.db.receipt.update({ where: { id: r.receipt.id }, data: { itemsJson: '[]' } }),
    ).rejects.toThrow();
  });
});

describe('paidItems (what a payment pays, oldest charges first)', () => {
  const ch = (
    id: string,
    date: string,
    amount: number,
    description: string,
    reversalOfId: string | null = null,
  ) => ({
    id,
    studentId: 's',
    amountAgorot: amount,
    date,
    type: 'x',
    yearName: 'y',
    description,
    reversalOfId,
    createdAt: new Date(date),
  });
  it('skips what earlier credits and discounts settled, ignores cancelled charges', () => {
    const charges = [
      ch('1', '2026-09-01', 100000, 'שכר לימוד'),
      ch('2', '2026-09-02', -20000, 'הנחה'),
      ch('3', '2026-09-05', 5000, 'טיול'),
      ch('4', '2026-09-06', 5000, 'ביטול: טיול', '3'),
      ch('5', '2026-10-31', 40000, 'שיעור פרטי'),
    ];
    const earlier = [
      {
        id: 'a',
        paymentId: 'p0',
        studentId: 's',
        amountAgorot: 50000,
        date: '2026-09-10',
        description: '',
        createdAt: new Date(),
      },
    ];
    expect(paidItems(charges, earlier, 60000)).toEqual([
      { description: 'שכר לימוד', amountAgorot: 30000 },
      { description: 'שיעור פרטי', amountAgorot: 30000 },
    ]);
  });
});
