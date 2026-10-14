import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CHARGE_TYPE_KEYS,
  bulkChargeSchema,
  catalogCreateSchema,
  chargeCreateSchema,
  discountCreateSchema,
  formatMoney,
  normalizeGrade,
  reasonSchema,
  type ChargeRow,
  type ChargeType,
} from '@tuition/shared';
import { staff } from '../../plugins/access';
import { actorOf } from '../../plugins/auth';
import { badRequest, conflict, notFound, parse } from '../../lib/errors';
import { recordAudit } from '../audit/service';
import { getSettings } from '../settings/service';
import { addCharge, recalcSiblings, reverseCharge } from '../finance/charges';
import { todayOf } from '../finance/context';
import { createDiscount } from '../finance/discount';
import type { Db, Tx } from '../../lib/db';

const idParam = z.object({ id: z.string().min(1).max(40) });

async function bulkTargets(db: Db | Tx, input: z.infer<typeof bulkChargeSchema>) {
  const settings = await getSettings(db);
  let description = input.description?.trim() ?? '';
  let amountAgorot = input.amountAgorot ?? 0;
  let type: ChargeType = 'other';
  if (input.catalogItemId) {
    const item = await db.chargeCatalogItem.findFirst({ where: { id: input.catalogItemId, active: true } });
    if (!item) throw notFound('הפריט לא נמצא בקטלוג');
    description = item.name;
    amountAgorot = input.amountAgorot ?? item.defaultAgorot;
    type = item.type as ChargeType;
  }
  if (!description) throw badRequest('יש להזין תיאור', { description: 'שדה חובה' });
  if (!(amountAgorot > 0)) throw badRequest('יש להזין סכום חיובי', { amountAgorot: 'יש להזין סכום חיובי' });
  let grade: string | null = null;
  if (input.grade) {
    grade = normalizeGrade(input.grade, settings.grades);
    if (!grade) throw badRequest('כיתה לא מוכרת');
  }
  const students = await db.student.findMany({
    where: { status: 'active', deletedAt: null, ...(grade ? { grade } : {}) },
    orderBy: { enrollSeq: 'asc' },
    select: { id: true },
  });
  if (!students.length) throw badRequest('אין תלמידים מתאימים');
  return { description, amountAgorot, type, grade, students, yearName: settings.activeYearName };
}

export async function chargeRoutes(app: FastifyInstance) {
  const deps = app.deps;
  const { db, clock } = deps;

  app.get('/api/charges', { config: { access: staff('charges') } }, async (req) => {
    const { type, limit } = parse(
      z.object({
        type: z.enum(CHARGE_TYPE_KEYS as [ChargeType, ...ChargeType[]]).optional(),
        limit: z.coerce.number().int().min(1).max(500).default(60),
      }),
      req.query,
    );
    const rows = await db.charge.findMany({
      where: type ? { type } : {},
      include: { student: { select: { fullName: true } }, reversedBy: { select: { id: true } } },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: limit,
    });
    const out: ChargeRow[] = rows.map((c) => ({
      id: c.id,
      date: c.date,
      studentId: c.studentId,
      studentName: c.student.fullName,
      description: c.description,
      type: c.type as ChargeType,
      amountAgorot: c.amountAgorot,
      cancelled: !!c.reversedBy,
      isReversal: !!c.reversalOfId,
    }));
    return { charges: out };
  });

  app.post('/api/charges', { config: { access: staff('charges') } }, async (req) => {
    const input = parse(chargeCreateSchema, req.body);
    const settings = await getSettings(db);
    const now = clock.now();
    return db.$transaction(async (tx) => {
      const s = await tx.student.findFirst({ where: { id: input.studentId, deletedAt: null } });
      if (!s) throw notFound('התלמיד לא נמצא');
      const c = await addCharge(tx, {
        ...input,
        yearName: settings.activeYearName,
        createdById: req.auth!.user.id,
      });
      await recordAudit(tx, actorOf(req), now, {
        action: 'charge.create',
        summary: `חיוב ${formatMoney(c.amountAgorot)} ל${s.fullName}: ${c.description}`,
        entity: 'Charge',
        entityId: c.id,
        after: c,
      });
      return { chargeId: c.id };
    });
  });

  app.post('/api/charges/bulk/preview', { config: { access: staff('charges') } }, async (req) => {
    const input = parse(bulkChargeSchema, req.body);
    const t = await bulkTargets(db, input);
    return {
      description: t.description,
      amountAgorot: t.amountAgorot,
      count: t.students.length,
      totalAgorot: t.amountAgorot * t.students.length,
    };
  });

  app.post('/api/charges/bulk', { config: { access: staff('charges') } }, async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { expectedCount } = parse(
      z.object({ expectedCount: z.number().int().positive() }).passthrough(),
      body,
    );
    const { expectedCount: _e, ...rest } = body;
    const input = parse(bulkChargeSchema, rest);
    const now = clock.now();
    return db.$transaction(async (tx) => {
      const t = await bulkTargets(tx, input);
      if (t.students.length !== expectedCount)
        throw conflict('רשימת התלמידים השתנתה מאז התצוגה המקדימה. נסו שוב');
      const batch = await tx.chargeBatch.create({
        data: {
          description: t.description,
          catalogItemId: input.catalogItemId ?? null,
          grade: t.grade,
          count: t.students.length,
          amountAgorot: t.amountAgorot,
          date: input.date,
          createdById: req.auth!.user.id,
        },
      });
      for (const s of t.students) {
        await addCharge(tx, {
          studentId: s.id,
          type: t.type,
          description: t.description,
          amountAgorot: t.amountAgorot,
          date: input.date,
          yearName: t.yearName,
          batchId: batch.id,
          createdById: req.auth!.user.id,
        });
      }
      await recordAudit(tx, actorOf(req), now, {
        action: 'charge.bulk',
        summary: `חיוב קבוצתי: ${t.description}, ${t.students.length} תלמידים`,
        entity: 'ChargeBatch',
        entityId: batch.id,
        after: batch,
      });
      return { batchId: batch.id, count: t.students.length };
    });
  });

  app.post('/api/charges/discount', { config: { access: staff('charges') } }, async (req) => {
    const input = parse(discountCreateSchema, req.body);
    const settings = await getSettings(db);
    const now = clock.now();
    const today = todayOf(deps);
    return db.$transaction(async (tx) => {
      const r = await createDiscount(tx, input, {
        actor: actorOf(req),
        now,
        today,
        yearName: settings.activeYearName,
        createdById: req.auth!.user.id,
      });
      return { chargeId: r.chargeId, amountAgorot: r.amountAgorot };
    });
  });

  app.post('/api/charges/:id/cancel', { config: { access: staff('charges') } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { reason } = parse(reasonSchema, req.body);
    const now = clock.now();
    const today = todayOf(deps);
    const actor = actorOf(req);
    return db.$transaction(async (tx) => {
      const c = await tx.charge.findUnique({ where: { id }, include: { student: true } });
      if (!c) throw notFound('החיוב לא נמצא');
      if (c.type === 'sib') throw conflict('הנחת אחים מחושבת אוטומטית ואינה ניתנת לביטול ידני');
      const rev = await reverseCharge(tx, id, reason, today, actor.id);
      if (c.type === 'tuition') await recalcSiblings(tx, c.student.familyId, actor, now, today);
      await recordAudit(tx, actor, now, {
        action: 'charge.cancel',
        summary: `בוטל חיוב: ${c.description} ל${c.student.fullName} (${reason})`,
        entity: 'Charge',
        entityId: id,
        before: c,
        after: rev,
      });
      return { reversalId: rev.id };
    });
  });

  // ---------- catalog ----------
  app.get('/api/catalog', { config: { access: staff(['charges', 'pay']) } }, async () => ({
    items: await db.chargeCatalogItem.findMany({ where: { active: true }, orderBy: { createdAt: 'asc' } }),
  }));

  app.post('/api/catalog', { config: { access: staff('charges') } }, async (req) => {
    const input = parse(catalogCreateSchema, req.body);
    return db.$transaction(async (tx) => {
      const item = await tx.chargeCatalogItem.create({ data: input });
      await recordAudit(tx, actorOf(req), clock.now(), {
        action: 'catalog.create',
        summary: `נוסף פריט לקטלוג: ${item.name}`,
        entity: 'ChargeCatalogItem',
        entityId: item.id,
        after: item,
      });
      return { item };
    });
  });

  app.post('/api/catalog/:id/remove', { config: { access: staff('charges') } }, async (req) => {
    const { id } = parse(idParam, req.params);
    return db.$transaction(async (tx) => {
      const item = await tx.chargeCatalogItem.findUnique({ where: { id } });
      if (!item || !item.active) throw notFound('הפריט לא נמצא');
      await tx.chargeCatalogItem.update({ where: { id }, data: { active: false } });
      await recordAudit(tx, actorOf(req), clock.now(), {
        action: 'catalog.remove',
        summary: `הוסר פריט מהקטלוג: ${item.name}`,
        entity: 'ChargeCatalogItem',
        entityId: id,
        before: item,
      });
      return { ok: true };
    });
  });
}
