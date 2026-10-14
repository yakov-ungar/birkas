import type { ChargeType } from '@tuition/shared';
import type { Tx } from '../../lib/db';
import { conflict, notFound } from '../../lib/errors';
import { recordAudit, type Actor } from '../audit/service';
import { siblingDiscounts } from '../../domain/siblings';
import { getSettings } from '../settings/service';
import { tuitionOf } from './money';

export interface NewCharge {
  studentId: string;
  type: ChargeType;
  description: string;
  amountAgorot: number;
  date: string;
  yearName: string;
  reason?: string | null;
  internalNote?: string | null;
  batchId?: string | null;
  createdById?: string | null;
}

export const addCharge = (tx: Tx, c: NewCharge) =>
  tx.charge.create({
    data: {
      studentId: c.studentId,
      type: c.type,
      description: c.description,
      amountAgorot: c.amountAgorot,
      date: c.date,
      yearName: c.yearName,
      reason: c.reason ?? null,
      internalNote: c.internalNote ?? null,
      batchId: c.batchId ?? null,
      createdById: c.createdById ?? null,
    },
  });

/** Cancels a charge by adding an opposite charge that points to it (never deletes). */
export async function reverseCharge(
  tx: Tx,
  chargeId: string,
  reason: string,
  date: string,
  createdById: string | null,
) {
  const c = await tx.charge.findUnique({ where: { id: chargeId }, include: { reversedBy: true } });
  if (!c) throw notFound('החיוב לא נמצא');
  if (c.reversalOfId) throw conflict('לא ניתן לבטל שורת ביטול');
  if (c.reversedBy) throw conflict('החיוב כבר בוטל');
  return tx.charge.create({
    data: {
      studentId: c.studentId,
      yearName: c.yearName,
      type: c.type,
      description: `ביטול: ${c.description}`,
      amountAgorot: -c.amountAgorot,
      date,
      reason,
      reversalOfId: c.id,
      createdById,
    },
  });
}

/**
 * Brings every family member's sibling discount for the active year to what the rules require
 * (decision B3): when the stored discount differs, the old rows are reversed and a new one added.
 */
export async function recalcSiblings(tx: Tx, familyId: string, actor: Actor, now: Date, today: string) {
  const s = await getSettings(tx);
  const year = s.activeYearName;
  const kids = await tx.student.findMany({ where: { familyId, deletedAt: null } });
  const inputs = await Promise.all(
    kids.map(async (k) => ({
      studentId: k.id,
      active: k.status === 'active',
      enrollSeq: k.enrollSeq,
      tuitionAgorot: await tuitionOf(tx, k.id, year),
    })),
  );
  const required = siblingDiscounts(inputs, s.siblingPct);
  const pctOf = new Map<string, number>();
  inputs
    .filter((i) => i.active)
    .sort((a, b) => a.enrollSeq - b.enrollSeq)
    .forEach((s2, i) => pctOf.set(s2.studentId, s.siblingPct[Math.min(i, s.siblingPct.length - 1)] ?? 0));

  for (const k of kids) {
    const rows = await tx.charge.findMany({
      where: { studentId: k.id, yearName: year, type: 'sib' },
      include: { reversedBy: true },
    });
    const current = -rows.reduce((sum, r) => sum + r.amountAgorot, 0);
    const want = required.get(k.id) ?? 0;
    if (current === want) continue;
    for (const r of rows.filter((r) => !r.reversalOfId && !r.reversedBy)) {
      await reverseCharge(tx, r.id, 'חישוב מחדש של הנחת אחים', today, actor.id);
    }
    if (want > 0) {
      await addCharge(tx, {
        studentId: k.id,
        type: 'sib',
        description: `הנחת אחים (${pctOf.get(k.id)}%)`,
        amountAgorot: -want,
        date: today,
        yearName: year,
        createdById: actor.id,
      });
    }
    await recordAudit(tx, actor, now, {
      action: 'charge.sibling_recalc',
      summary: `הנחת אחים חושבה מחדש ל${k.fullName}`,
      entity: 'Student',
      entityId: k.id,
      before: { discountAgorot: current },
      after: { discountAgorot: want },
    });
  }
}
