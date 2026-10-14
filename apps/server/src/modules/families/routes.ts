import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  familyFields,
  normalizeGrade,
  normalizePhone,
  studentCreateSchema,
  studentStatusSchema,
  studentUpdateSchema,
  STUDENT_STATUS,
  type FamilyCard,
  type FamilyListRow,
  type SavedCardRow,
  type StudentCard,
  type StudentListRow,
  type StudentStatus,
} from '@tuition/shared';
import { staff } from '../../plugins/access';
import { actorOf } from '../../plugins/auth';
import { badRequest, conflict, notFound, parse } from '../../lib/errors';
import { recordAudit } from '../audit/service';
import { getSettings } from '../settings/service';
import { addAging, agingLabel, buildLedger, type AgingBuckets } from '../../domain/ledger';
import { addCharge, recalcSiblings, reverseCharge } from '../finance/charges';
import { EMPTY, loadMoney, summarize } from '../finance/money';
import { hasPerm, todayOf, userIdOf } from '../finance/context';
import type { Tx } from '../../lib/db';
import type { Prisma } from '@prisma/client';

const idParam = z.object({ id: z.string().min(1).max(40) });
const listQuery = z.object({
  q: z.string().trim().max(80).optional(),
  grade: z.string().trim().max(20).optional(),
  filter: z.enum(['act', 'debt', 'all', 'out']).default('act'),
});

export const familyNameFor = (studentName: string) => `משפחת ${studentName.trim().split(/\s+/).slice(-1)[0]}`;

export function cardRow(
  c: {
    id: string;
    studentId: string;
    last4: string;
    brand: string;
    expMonth: number;
    expYear: number;
    holderName: string;
    isDefault: boolean;
  },
  studentName: string,
  today: string,
): SavedCardRow {
  const [y, m] = today.split('-').map(Number) as [number, number];
  return {
    id: c.id,
    studentId: c.studentId,
    studentName,
    last4: c.last4,
    brand: c.brand,
    exp: `${String(c.expMonth).padStart(2, '0')}/${String(c.expYear % 100).padStart(2, '0')}`,
    // Valid through the last day of the expiry month (demo: expired once that month has passed).
    expired: c.expYear < y || (c.expYear === y && c.expMonth < m),
    holderName: c.holderName,
    isDefault: c.isDefault,
  };
}

async function nextEnrollSeq(tx: Tx) {
  const r = await tx.student.aggregate({ _max: { enrollSeq: true } });
  return (r._max.enrollSeq ?? 0) + 1;
}

export async function createFamily(tx: Tx, studentName: string, f: z.infer<typeof familyFields>) {
  return tx.family.create({
    data: {
      name: familyNameFor(studentName),
      parentName: f.parentName,
      phone: f.phone,
      phoneNorm: normalizePhone(f.phone),
      email: f.email ?? '',
      address: f.address ?? '',
      note: f.note ?? '',
    },
  });
}

export async function createStudent(
  tx: Tx,
  input: {
    familyId: string;
    fullName: string;
    grade: string;
    tuitionAgorot: number;
    date: string;
    yearName: string;
    createdById: string | null;
  },
) {
  const s = await tx.student.create({
    data: {
      familyId: input.familyId,
      fullName: input.fullName,
      grade: input.grade,
      enrollSeq: await nextEnrollSeq(tx),
    },
  });
  if (input.tuitionAgorot > 0) {
    await addCharge(tx, {
      studentId: s.id,
      type: 'tuition',
      description: `שכר לימוד ${input.yearName}`,
      amountAgorot: input.tuitionAgorot,
      date: input.date,
      yearName: input.yearName,
      createdById: input.createdById,
    });
  }
  return s;
}

const payStatus = (status: string, bal: number, paid: number): StudentListRow['payStatus'] =>
  status !== 'active' ? 'inactive' : bal <= 0 ? 'paid' : paid > 0 ? 'partial' : 'debt';

export async function familyRoutes(app: FastifyInstance) {
  const deps = app.deps;
  const { db, clock } = deps;

  app.get('/api/students', { config: { access: staff('stu_view') } }, async (req) => {
    const { q, grade, filter } = parse(listQuery, req.query);
    const today = todayOf(deps);
    const students = await db.student.findMany({
      where: { deletedAt: null },
      include: { family: true },
      orderBy: { enrollSeq: 'asc' },
    });
    const money = await loadMoney(db);
    const rows: StudentListRow[] = [];
    for (const s of students) {
      const m = summarize(money.get(s.id) ?? EMPTY, today);
      const hay = `${s.fullName} ${s.family.parentName} ${s.family.phone} ${s.family.phoneNorm} ${s.family.name}`;
      if (q && !hay.includes(q)) continue;
      if (grade && s.grade !== grade) continue;
      if (filter === 'act' && s.status !== 'active') continue;
      if (filter === 'out' && s.status === 'active') continue;
      if (filter === 'debt' && m.balanceAgorot <= 0) continue;
      rows.push({
        id: s.id,
        fullName: s.fullName,
        grade: s.grade,
        status: s.status as StudentStatus,
        familyId: s.familyId,
        familyName: s.family.name,
        parentName: s.family.parentName,
        phone: s.family.phone,
        netChargedAgorot: m.netChargedAgorot,
        paidAgorot: m.paidAgorot,
        balanceAgorot: m.balanceAgorot,
        payStatus: payStatus(s.status, m.balanceAgorot, m.paidAgorot),
      });
    }
    return { students: rows };
  });

  app.get('/api/families', { config: { access: staff('stu_view') } }, async () => {
    const today = todayOf(deps);
    const fams = await db.family.findMany({
      where: { archivedAt: null },
      include: { students: { where: { deletedAt: null } } },
      orderBy: { createdAt: 'asc' },
    });
    const money = await loadMoney(db);
    const rows: FamilyListRow[] = fams.map((f) => {
      let bal = 0;
      let aging: AgingBuckets = [0, 0, 0, 0];
      for (const s of f.students) {
        const m = summarize(money.get(s.id) ?? EMPTY, today);
        bal += m.balanceAgorot;
        aging = addAging(aging, m.aging);
      }
      return {
        id: f.id,
        name: f.name,
        parentName: f.parentName,
        phone: f.phone,
        email: f.email,
        childCount: f.students.length,
        balanceAgorot: bal,
        agingLabel: bal > 0 ? agingLabel(aging) : '-',
      };
    });
    return { families: rows };
  });

  app.get('/api/students/:id', { config: { access: staff('stu_view') } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const s = await db.student.findFirst({
      where: { id, deletedAt: null },
      include: { family: { include: { students: { where: { deletedAt: null } } } } },
    });
    if (!s) throw notFound('התלמיד לא נמצא');
    const today = todayOf(deps);
    const m = (await loadMoney(db, [id])).get(id) ?? EMPTY;
    const sum = summarize(m, today);
    const canCards = hasPerm(req, 'cards');
    const cards = canCards
      ? (
          await db.savedCard.findMany({
            where: { studentId: id, removedAt: null },
            orderBy: { createdAt: 'asc' },
          })
        ).map((c) => cardRow(c, s.fullName, today))
      : null;
    const [payCount, checkCount] = await Promise.all([
      db.paymentAllocation.count({ where: { studentId: id } }),
      db.check.count({ where: { studentId: id } }),
    ]);
    const body: StudentCard = {
      student: {
        id: s.id,
        fullName: s.fullName,
        grade: s.grade,
        status: s.status as StudentStatus,
        enrollSeq: s.enrollSeq,
      },
      family: {
        id: s.family.id,
        name: s.family.name,
        parentName: s.family.parentName,
        phone: s.family.phone,
        email: s.family.email,
      },
      siblings: s.family.students.filter((x) => x.id !== id).map((x) => ({ id: x.id, fullName: x.fullName })),
      ...sum,
      ledger: buildLedger(m.charges, m.credits).map((l) => ({ ...l, studentName: s.fullName })),
      cards,
      hasFinancialHistory: payCount + checkCount > 0,
    };
    return body;
  });

  app.get('/api/families/:id', { config: { access: staff('stu_view') } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const f = await db.family.findUnique({
      where: { id },
      include: { students: { where: { deletedAt: null }, orderBy: { enrollSeq: 'asc' } } },
    });
    if (!f) throw notFound('המשפחה לא נמצאה');
    const today = todayOf(deps);
    const money = await loadMoney(
      db,
      f.students.map((s) => s.id),
    );
    let aging: AgingBuckets = [0, 0, 0, 0];
    const students = f.students.map((s) => {
      const m = summarize(money.get(s.id) ?? EMPTY, today);
      aging = addAging(aging, m.aging);
      return {
        id: s.id,
        fullName: s.fullName,
        grade: s.grade,
        status: s.status as StudentStatus,
        balanceAgorot: m.balanceAgorot,
      };
    });
    const body: FamilyCard = {
      family: {
        id: f.id,
        name: f.name,
        parentName: f.parentName,
        phone: f.phone,
        email: f.email,
        address: f.address,
        note: f.note,
      },
      students,
      balanceAgorot: students.reduce((a, s) => a + s.balanceAgorot, 0),
      aging,
    };
    return body;
  });

  app.post('/api/students', { config: { access: staff('stu_edit') } }, async (req) => {
    const input = parse(studentCreateSchema, req.body);
    const settings = await getSettings(db);
    const grade = normalizeGrade(input.grade, settings.grades);
    if (!grade) throw badRequest('כיתה לא מוכרת', { grade: 'כיתה לא מוכרת' });
    const now = clock.now();
    const today = todayOf(deps);
    const actor = actorOf(req);
    const result = await db.$transaction(async (tx) => {
      let familyId = input.familyId;
      if (familyId) {
        if (!(await tx.family.findUnique({ where: { id: familyId } }))) throw notFound('המשפחה לא נמצאה');
      } else {
        const fam = await createFamily(tx, input.fullName, input.newFamily!);
        familyId = fam.id;
        await recordAudit(tx, actor, now, {
          action: 'family.create',
          summary: `נוספה משפחה: ${fam.name}`,
          entity: 'Family',
          entityId: fam.id,
          after: fam,
        });
      }
      const s = await createStudent(tx, {
        familyId,
        fullName: input.fullName,
        grade,
        tuitionAgorot: input.tuitionAgorot,
        date: today,
        yearName: settings.activeYearName,
        createdById: actor.id,
      });
      await recalcSiblings(tx, familyId, actor, now, today);
      await recordAudit(tx, actor, now, {
        action: 'student.create',
        summary: `נוסף תלמיד: ${s.fullName}`,
        entity: 'Student',
        entityId: s.id,
        after: { ...s, tuitionAgorot: input.tuitionAgorot },
      });
      const sib = await tx.charge.aggregate({
        where: { studentId: s.id, type: 'sib', yearName: settings.activeYearName },
        _sum: { amountAgorot: true },
      });
      return { studentId: s.id, familyId, siblingDiscountAgorot: -(sib._sum.amountAgorot ?? 0) };
    });
    return result;
  });

  app.patch('/api/families/:id', { config: { access: staff('stu_edit') } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const input = parse(familyFields, req.body);
    const now = clock.now();
    return db.$transaction(async (tx) => {
      const f = await tx.family.findUnique({ where: { id } });
      if (!f) throw notFound('המשפחה לא נמצאה');
      const next = await tx.family.update({
        where: { id },
        data: {
          parentName: input.parentName,
          phone: input.phone,
          phoneNorm: normalizePhone(input.phone),
          email: input.email ?? '',
          address: input.address ?? '',
          note: input.note ?? '',
        },
      });
      await recordAudit(tx, actorOf(req), now, {
        action: 'family.update',
        summary: `עודכנו פרטי ${f.name}`,
        entity: 'Family',
        entityId: id,
        before: f,
        after: next,
      });
      return { ok: true };
    });
  });

  app.patch('/api/students/:id', { config: { access: staff('stu_edit') } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const input = parse(studentUpdateSchema, req.body);
    const settings = await getSettings(db);
    const data: Prisma.StudentUpdateInput = {};
    if (input.fullName) data.fullName = input.fullName;
    if (input.grade) {
      const g = normalizeGrade(input.grade, settings.grades);
      if (!g) throw badRequest('כיתה לא מוכרת', { grade: 'כיתה לא מוכרת' });
      data.grade = g;
    }
    if (input.enrollSeq !== undefined) data.enrollSeq = input.enrollSeq;
    const now = clock.now();
    const actor = actorOf(req);
    return db.$transaction(async (tx) => {
      const s = await tx.student.findFirst({ where: { id, deletedAt: null } });
      if (!s) throw notFound('התלמיד לא נמצא');
      const next = await tx.student.update({ where: { id }, data });
      if (input.enrollSeq !== undefined && input.enrollSeq !== s.enrollSeq)
        await recalcSiblings(tx, s.familyId, actor, now, todayOf(deps));
      await recordAudit(tx, actor, now, {
        action: 'student.update',
        summary: `עודכנו פרטי ${s.fullName}`,
        entity: 'Student',
        entityId: id,
        before: s,
        after: next,
      });
      return { ok: true };
    });
  });

  app.post('/api/students/:id/status', { config: { access: staff('stu_edit') } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { status } = parse(studentStatusSchema, req.body);
    const now = clock.now();
    const actor = actorOf(req);
    const today = todayOf(deps);
    const s = await db.$transaction(async (tx) => {
      const s = await tx.student.findFirst({ where: { id, deletedAt: null } });
      if (!s) throw notFound('התלמיד לא נמצא');
      await tx.student.update({ where: { id }, data: { status } });
      await recalcSiblings(tx, s.familyId, actor, now, today);
      await recordAudit(tx, actor, now, {
        action: 'student.status',
        summary: `סטטוס ${s.fullName}: ${STUDENT_STATUS[status]}`,
        entity: 'Student',
        entityId: id,
        before: { status: s.status },
        after: { status },
      });
      return s;
    });
    const m = summarize((await loadMoney(db, [id])).get(id) ?? EMPTY, today);
    return {
      ok: true,
      remainingBalanceAgorot: status !== 'active' && m.balanceAgorot > 0 ? m.balanceAgorot : 0,
      studentName: s.fullName,
    };
  });

  /**
   * Decision B2: only a student without payments, checks or saved cards can be removed
   * (e.g. added by mistake). Their charges are reversed, never deleted, and the row is kept.
   */
  app.post('/api/students/:id/delete', { config: { access: staff('stu_edit') } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const now = clock.now();
    const actor = actorOf(req);
    const today = todayOf(deps);
    await db.$transaction(async (tx) => {
      const s = await tx.student.findFirst({ where: { id, deletedAt: null } });
      if (!s) throw notFound('התלמיד לא נמצא');
      const [p, c, k] = await Promise.all([
        tx.paymentAllocation.count({ where: { studentId: id } }),
        tx.check.count({ where: { studentId: id } }),
        tx.savedCard.count({ where: { studentId: id, removedAt: null } }),
      ]);
      if (p || c || k)
        throw conflict('לתלמיד יש תשלומים, שיקים או כרטיסים. במקום מחיקה יש לשנות סטטוס ל"עזב"');
      const live = await tx.charge.findMany({
        where: { studentId: id, reversalOfId: null, reversedBy: null },
      });
      for (const ch of live) await reverseCharge(tx, ch.id, 'מחיקת תלמיד', today, userIdOf(req));
      await tx.student.update({ where: { id }, data: { deletedAt: now, status: 'left' } });
      await recalcSiblings(tx, s.familyId, actor, now, today);
      await recordAudit(tx, actor, now, {
        action: 'student.delete',
        summary: `נמחק תלמיד: ${s.fullName}`,
        entity: 'Student',
        entityId: id,
        before: s,
      });
    });
    return { ok: true };
  });
}
