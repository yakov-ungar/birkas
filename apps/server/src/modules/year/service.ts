import { formatMoney, type YearInfo, type YearOpenInput, type YearPreview } from '@tuition/shared';
import type { Deps } from '../../deps';
import type { Db, Tx } from '../../lib/db';
import { israelDate } from '../../lib/clock';
import { badRequest, conflict } from '../../lib/errors';
import { siblingDiscounts } from '../../domain/siblings';
import { recordAudit, type Actor } from '../audit/service';
import { addCharge, recalcSiblings } from '../finance/charges';
import { getSettings, saveSettings } from '../settings/service';
import { schoolYears } from '../reports/service';

export async function yearInfo(db: Db): Promise<YearInfo> {
  const s = await getSettings(db);
  return {
    activeYearName: s.activeYearName,
    activeStudents: await db.student.count({ where: { deletedAt: null, status: 'active' } }),
    graduated: await db.student.count({ where: { deletedAt: null, status: 'graduated' } }),
    years: await schoolYears(db),
  };
}

/** What opening the year would do (demo newYear). Read only: the dry run changes nothing. */
export async function previewYear(db: Db | Tx, input: YearOpenInput): Promise<YearPreview> {
  const s = await getSettings(db);
  const name = input.yearName.trim();
  if (name === s.activeYearName) throw badRequest('שנה זו כבר פעילה', { yearName: 'שנה זו כבר פעילה' });
  if (await db.charge.count({ where: { yearName: name } }))
    throw badRequest('לשנה זו כבר קיימים חיובים', { yearName: 'שנה שכבר נפתחה' });
  const last = s.grades[s.grades.length - 1]!;
  const active = await db.student.findMany({ where: { deletedAt: null, status: 'active' } });
  const graduating = active.filter((x) => x.grade === last);
  const staying = active.filter((x) => x.grade !== last);
  // Sibling discounts the new charges will get, computed the same way the year opening will.
  const byFamily = new Map<string, typeof staying>();
  for (const st of staying) byFamily.set(st.familyId, [...(byFamily.get(st.familyId) ?? []), st]);
  let sib = 0;
  for (const kids of byFamily.values()) {
    const d = siblingDiscounts(
      kids.map((k) => ({
        studentId: k.id,
        active: true,
        enrollSeq: k.enrollSeq,
        tuitionAgorot: input.tuitionAgorot,
      })),
      s.siblingPct,
    );
    for (const v of d.values()) sib += v;
  }
  return {
    yearName: name,
    promoted: staying.length,
    graduating: graduating.length,
    graduatingGrade: last,
    newCharges: staying.length,
    totalAgorot: staying.length * input.tuitionAgorot,
    siblingDiscountAgorot: sib,
    previousYear: s.activeYearName,
  };
}

/**
 * Opens the year in one transaction: the last grade graduates, everyone else moves up a grade
 * and gets the new tuition, sibling discounts are recalculated, and the year becomes active.
 * Previous balances stay as they are. A run key per year name makes it impossible to run twice.
 */
export async function openYear(deps: Deps, input: YearOpenInput, actor: Actor) {
  const { db, clock } = deps;
  const now = clock.now();
  const today = israelDate(now);
  return db.$transaction(async (tx) => {
    const preview = await previewYear(tx, input);
    const s = await getSettings(tx);
    const exists = await tx.jobRun.findUnique({
      where: { job_runKey: { job: 'year_open', runKey: preview.yearName } },
    });
    if (exists) throw conflict('פתיחת השנה כבר בוצעה');
    const run = await tx.jobRun.create({
      data: {
        job: 'year_open',
        runKey: preview.yearName,
        trigger: 'manual',
        startedAt: now,
        status: 'running',
      },
    });
    const last = s.grades[s.grades.length - 1]!;
    const active = await tx.student.findMany({ where: { deletedAt: null, status: 'active' } });
    await saveSettings(tx, { activeYearName: preview.yearName });
    const families = new Set<string>();
    let promoted = 0;
    let graduated = 0;
    for (const st of active) {
      families.add(st.familyId);
      if (st.grade === last) {
        await tx.student.update({ where: { id: st.id }, data: { status: 'graduated' } });
        graduated++;
        continue;
      }
      const i = s.grades.indexOf(st.grade);
      const grade = i >= 0 ? s.grades[i + 1]! : st.grade;
      await tx.student.update({ where: { id: st.id }, data: { grade } });
      await addCharge(tx, {
        studentId: st.id,
        type: 'tuition',
        description: `שכר לימוד ${preview.yearName}`,
        amountAgorot: input.tuitionAgorot,
        date: input.chargeDate,
        yearName: preview.yearName,
        createdById: actor.id,
      });
      promoted++;
    }
    for (const fid of families) await recalcSiblings(tx, fid, actor, now, today);
    const summary = `נפתחה שנת לימודים ${preview.yearName}: עלו כיתה ${promoted}, סיימו ${graduated}, חיובים ${formatMoney(promoted * input.tuitionAgorot)}`;
    await tx.jobRun.update({
      where: { id: run.id },
      data: { status: 'ok', finishedAt: now, okCount: promoted, summary },
    });
    await recordAudit(tx, actor, now, {
      action: 'year.open',
      summary,
      entity: 'Setting',
      before: { activeYearName: s.activeYearName },
      after: {
        activeYearName: preview.yearName,
        tuitionAgorot: input.tuitionAgorot,
        chargeDate: input.chargeDate,
      },
    });
    return { promoted, graduated, yearName: preview.yearName };
  });
}
