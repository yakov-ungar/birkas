import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  formatMoney,
  monthLabel,
  tutorPatchSchema,
  tutorSchema,
  tutorSubjectsSchema,
  tutoringCreateSchema,
  tutoringEndSchema,
  tutoringRunSchema,
  type TutorRow,
} from '@tuition/shared';
import { staff } from '../../plugins/access';
import { actorOf } from '../../plugins/auth';
import { badRequest, conflict, notFound, parse } from '../../lib/errors';
import { recordAudit } from '../audit/service';
import { getSettings, saveSettings } from '../settings/service';
import { todayOf } from '../finance/context';
import { chargeTutoringMonth, monthBounds, monthOf, tutoringRows } from './service';

const idParam = z.object({ id: z.string().min(1).max(40) });

/** Private lessons with אברכים: tutors and subjects (settings), lessons per student, month-end charges. */
export async function tutoringRoutes(app: FastifyInstance) {
  const deps = app.deps;
  const { db, clock } = deps;

  // ---------- tutors and subjects ----------

  app.get('/api/tutors', { config: { access: staff(['charges', 'stu_view', 'settings']) } }, async () => {
    const tutors = await db.tutor.findMany({
      include: { assignments: { where: { endDate: null }, select: { id: true } } },
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
    const out: TutorRow[] = tutors.map((t) => ({
      id: t.id,
      name: t.name,
      phone: t.phone,
      active: t.active,
      activeStudents: t.assignments.length,
    }));
    return { tutors: out, subjects: (await getSettings(db)).tutorSubjects };
  });

  app.post('/api/tutors', { config: { access: staff('settings') } }, async (req) => {
    const input = parse(tutorSchema, req.body);
    return db.$transaction(async (tx) => {
      const t = await tx.tutor.create({ data: { name: input.name, phone: input.phone ?? '' } });
      await recordAudit(tx, actorOf(req), clock.now(), {
        action: 'tutor.create',
        summary: `נוסף אברך: ${t.name}`,
        entity: 'Tutor',
        entityId: t.id,
        after: t,
      });
      return { id: t.id };
    });
  });

  app.patch('/api/tutors/:id', { config: { access: staff('settings') } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const input = parse(tutorPatchSchema, req.body);
    return db.$transaction(async (tx) => {
      const before = await tx.tutor.findUnique({ where: { id } });
      if (!before) throw notFound('האברך לא נמצא');
      const after = await tx.tutor.update({ where: { id }, data: input });
      await recordAudit(tx, actorOf(req), clock.now(), {
        action: 'tutor.update',
        summary: `עודכן אברך: ${after.name}${input.active === false ? ' (לא פעיל)' : ''}`,
        entity: 'Tutor',
        entityId: id,
        before,
        after,
      });
      return { ok: true };
    });
  });

  app.put('/api/settings/tutor-subjects', { config: { access: staff('settings') } }, async (req) => {
    const { tutorSubjects } = parse(tutorSubjectsSchema, req.body);
    if (new Set(tutorSubjects).size !== tutorSubjects.length)
      throw badRequest('מקצוע מופיע פעמיים', { tutorSubjects: 'מקצוע מופיע פעמיים' });
    const before = (await getSettings(db)).tutorSubjects;
    await db.$transaction(async (tx) => {
      await saveSettings(tx, { tutorSubjects });
      await recordAudit(tx, actorOf(req), clock.now(), {
        action: 'settings.tutor_subjects',
        summary: 'עודכנה רשימת המקצועות לשיעורים פרטיים',
        entity: 'Setting',
        before: { tutorSubjects: before },
        after: { tutorSubjects },
      });
    });
    return { tutorSubjects };
  });

  // ---------- lessons ----------

  app.get('/api/tutoring', { config: { access: staff(['charges', 'stu_view']) } }, async (req) => {
    const { studentId } = parse(z.object({ studentId: z.string().min(1).max(40).optional() }), req.query);
    return { lessons: await tutoringRows(db, studentId ? { studentId } : {}) };
  });

  app.post('/api/tutoring', { config: { access: staff('charges') } }, async (req) => {
    const input = parse(tutoringCreateSchema, req.body);
    const { tutorSubjects } = await getSettings(db);
    if (!tutorSubjects.includes(input.subject))
      throw badRequest('המקצוע אינו ברשימה שבהגדרות', { subject: 'מקצוע לא מוכר' });
    return db.$transaction(async (tx) => {
      const s = await tx.student.findFirst({ where: { id: input.studentId, deletedAt: null } });
      if (!s) throw notFound('התלמיד לא נמצא');
      const t = await tx.tutor.findFirst({ where: { id: input.tutorId, active: true } });
      if (!t) throw notFound('האברך לא נמצא או שאינו פעיל');
      const a = await tx.tutorAssignment.create({
        data: {
          studentId: s.id,
          tutorId: t.id,
          subject: input.subject,
          priceAgorot: input.priceAgorot,
          startDate: input.startDate,
          note: input.note ?? '',
          createdById: req.auth!.user.id,
        },
      });
      await recordAudit(tx, actorOf(req), clock.now(), {
        action: 'tutoring.create',
        summary: `נוסף שיעור פרטי ל${s.fullName}: ${input.subject} עם ${t.name}, ${formatMoney(input.priceAgorot)} לחודש`,
        entity: 'TutorAssignment',
        entityId: a.id,
        after: a,
      });
      return { id: a.id };
    });
  });

  /** Stops the lesson. The month of the end date is still charged in full (no partial months). */
  app.post('/api/tutoring/:id/end', { config: { access: staff('charges') } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { endDate } = parse(tutoringEndSchema, req.body);
    return db.$transaction(async (tx) => {
      const a = await tx.tutorAssignment.findUnique({ where: { id }, include: { student: true } });
      if (!a) throw notFound('השיעור לא נמצא');
      if (a.endDate) throw conflict('השיעור כבר הסתיים');
      if (endDate < a.startDate)
        throw badRequest('תאריך הסיום לפני תאריך ההתחלה', { endDate: 'תאריך לא תקין' });
      const after = await tx.tutorAssignment.update({ where: { id }, data: { endDate } });
      await recordAudit(tx, actorOf(req), clock.now(), {
        action: 'tutoring.end',
        summary: `הסתיים שיעור פרטי של ${a.student.fullName}: ${a.subject}`,
        entity: 'TutorAssignment',
        entityId: id,
        before: a,
        after,
      });
      return { ok: true };
    });
  });

  /**
   * Runs the month-end charge by hand (normally the scheduler does it on the last day of the month).
   * Only for a month that has reached its last day; already charged lessons are skipped.
   */
  app.post('/api/tutoring/run', { config: { access: staff('charges') } }, async (req) => {
    const { month } = parse(tutoringRunSchema, req.body);
    const today = todayOf(deps);
    if (today < monthBounds(month).last)
      throw badRequest(`החיוב לחודש ${monthLabel(month)} יתבצע ביום האחרון של החודש`, {
        month: 'החודש עוד לא הסתיים',
      });
    const r = await chargeTutoringMonth(deps, month, actorOf(req));
    return { month, ...r, currentMonth: monthOf(today) };
  });
}
