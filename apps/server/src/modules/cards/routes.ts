import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { cardCreateSchema } from '@tuition/shared';
import { staff } from '../../plugins/access';
import { actorOf } from '../../plugins/auth';
import { conflict, notFound, parse } from '../../lib/errors';
import { recordAudit } from '../audit/service';
import { cardRow } from '../families/routes';
import { todayOf } from '../finance/context';
import { linkedPlanCounts, saveCard } from './service';

const idParam = z.object({ id: z.string().min(1).max(40) });

export async function cardRoutes(app: FastifyInstance) {
  const deps = app.deps;
  const { db, clock } = deps;

  app.get('/api/cards', { config: { access: staff('cards') } }, async () => {
    const today = todayOf(deps);
    const rows = await db.savedCard.findMany({
      where: { removedAt: null, student: { deletedAt: null } },
      include: { student: { select: { fullName: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const linked = await linkedPlanCounts(
      db,
      rows.map((c) => c.id),
    );
    return {
      cards: rows.map((c) => cardRow(c, c.student.fullName, today, linked.get(c.id) ?? 0)),
      hostedFieldsUrl: deps.payments.hostedFieldsUrl(),
    };
  });

  /** Saves a card from the provider's hosted fields without charging it. */
  app.post('/api/cards', { config: { access: staff('cards') } }, async (req) => {
    const { studentId, card } = parse(cardCreateSchema, req.body);
    const s = await db.student.findFirst({ where: { id: studentId, deletedAt: null } });
    if (!s) throw notFound('התלמיד לא נמצא');
    const c = await saveCard(deps, { studentId, card, actor: actorOf(req) });
    return { card: cardRow(c, s.fullName, todayOf(deps)) };
  });

  app.post('/api/cards/:id/default', { config: { access: staff('cards') } }, async (req) => {
    const { id } = parse(idParam, req.params);
    return db.$transaction(async (tx) => {
      const c = await tx.savedCard.findFirst({ where: { id, removedAt: null } });
      if (!c) throw notFound('הכרטיס לא נמצא');
      await tx.savedCard.updateMany({ where: { studentId: c.studentId }, data: { isDefault: false } });
      await tx.savedCard.update({ where: { id }, data: { isDefault: true } });
      await recordAudit(tx, actorOf(req), clock.now(), {
        action: 'card.default',
        summary: `כרטיס ****${c.last4} הוגדר כברירת מחדל`,
        entity: 'SavedCard',
        entityId: id,
      });
      return { ok: true };
    });
  });

  app.post('/api/cards/:id/remove', { config: { access: staff('cards') } }, async (req) => {
    const { id } = parse(idParam, req.params);
    return db.$transaction(async (tx) => {
      const c = await tx.savedCard.findFirst({ where: { id, removedAt: null } });
      if (!c) throw notFound('הכרטיס לא נמצא');
      if ((await linkedPlanCounts(tx, [id])).get(id)) {
        throw conflict('הכרטיס משויך לתוכנית חיוב פעילה. החלף כרטיס בתוכנית או בטל אותה קודם');
      }
      await tx.savedCard.update({ where: { id }, data: { removedAt: clock.now(), isDefault: false } });
      if (c.isDefault) {
        const next = await tx.savedCard.findFirst({
          where: { studentId: c.studentId, removedAt: null },
          orderBy: { createdAt: 'asc' },
        });
        if (next) await tx.savedCard.update({ where: { id: next.id }, data: { isDefault: true } });
      }
      await recordAudit(tx, actorOf(req), clock.now(), {
        action: 'card.remove',
        summary: `הוסר כרטיס ****${c.last4}`,
        entity: 'SavedCard',
        entityId: id,
      });
      return { ok: true };
    });
  });
}
