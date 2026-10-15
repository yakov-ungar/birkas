import { formatMoney, monthLabel, type TutoringRow } from '@tuition/shared';
import type { Deps } from '../../deps';
import type { Db, Tx } from '../../lib/db';
import { israelDate } from '../../lib/clock';
import { recordAudit, SYSTEM_ACTOR, type Actor } from '../audit/service';
import { addCharge } from '../finance/charges';
import { getSettings } from '../settings/service';

/** "2026-10" → first and last day ("2026-10-01", "2026-10-31"). */
export function monthBounds(month: string) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { first: `${month}-01`, last: `${month}-${String(last).padStart(2, '0')}` };
}

export const monthOf = (date: string) => date.slice(0, 7);

export function previousMonth(month: string) {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export const tutorChargeText = (subject: string, tutorName: string, month: string) =>
  `שיעור פרטי: ${subject} · ${tutorName} · ${monthLabel(month)}`;

/**
 * Charges every private lesson for `month`, once: a lesson counts for the month when it started on
 * or before the month's last day and did not end before its first day (the full monthly price; no
 * partial months). Students who are no longer active are skipped. Safe to run again: the
 * (lesson, month) pair is unique, so a second run adds nothing.
 */
export async function chargeTutoringMonth(
  deps: Deps,
  month: string,
  actor: Actor = SYSTEM_ACTOR,
): Promise<{ charged: number; totalAgorot: number }> {
  const { db, clock } = deps;
  const { first, last } = monthBounds(month);
  const now = clock.now();
  const due = await db.tutorAssignment.findMany({
    where: {
      startDate: { lte: last },
      OR: [{ endDate: null }, { endDate: { gte: first } }],
      student: { deletedAt: null, status: 'active' },
      charges: { none: { month } },
    },
    include: { tutor: true, student: true },
  });
  let charged = 0;
  let totalAgorot = 0;
  for (const a of due) {
    const done = await db.$transaction(async (tx) => {
      if (await tx.tutorCharge.findUnique({ where: { assignmentId_month: { assignmentId: a.id, month } } }))
        return false;
      const { activeYearName } = await getSettings(tx);
      const c = await addCharge(tx, {
        studentId: a.studentId,
        type: 'tutor',
        description: tutorChargeText(a.subject, a.tutor.name, month),
        amountAgorot: a.priceAgorot,
        date: last,
        yearName: activeYearName,
        createdById: actor.id,
      });
      await tx.tutorCharge.create({ data: { assignmentId: a.id, month, chargeId: c.id } });
      await recordAudit(tx, actor, now, {
        action: 'tutoring.charge',
        summary: `חיוב שיעור פרטי ${formatMoney(a.priceAgorot)} ל${a.student.fullName}: ${a.subject} (${monthLabel(month)})`,
        entity: 'Charge',
        entityId: c.id,
        after: c,
      });
      return true;
    });
    if (done) {
      charged++;
      totalAgorot += a.priceAgorot;
    }
  }
  return { charged, totalAgorot };
}

/**
 * Called by the scheduler after the nightly run time: on the last day of the month it charges that
 * month; in the first three days of a month it catches up on the previous one (the server may have
 * been down at month end). Both are idempotent.
 */
export async function monthEndTutoring(deps: Deps) {
  const today = israelDate(deps.clock.now());
  const month = monthOf(today);
  const out: Record<string, number> = {};
  if (today === monthBounds(month).last) out[month] = (await chargeTutoringMonth(deps, month)).charged;
  if (Number(today.slice(8, 10)) <= 3) {
    const prev = previousMonth(month);
    out[prev] = (await chargeTutoringMonth(deps, prev)).charged;
  }
  return out;
}

export async function tutoringRows(db: Db | Tx, where: { studentId?: string } = {}): Promise<TutoringRow[]> {
  const rows = await db.tutorAssignment.findMany({
    where: { ...where, student: { deletedAt: null } },
    include: { tutor: true, student: { select: { fullName: true } }, charges: { select: { month: true } } },
    orderBy: [{ endDate: 'asc' }, { createdAt: 'asc' }],
  });
  return rows.map((a) => ({
    id: a.id,
    studentId: a.studentId,
    studentName: a.student.fullName,
    tutorId: a.tutorId,
    tutorName: a.tutor.name,
    subject: a.subject,
    priceAgorot: a.priceAgorot,
    startDate: a.startDate,
    endDate: a.endDate,
    note: a.note,
    chargedMonths: a.charges.map((c) => c.month).sort(),
  }));
}
