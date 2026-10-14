import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  portalCardSchema,
  portalPaySchema,
  portalRequestSchema,
  type PaymentResult,
  type PortalMe,
} from '@tuition/shared';
import { PARENT, staff } from '../../plugins/access';
import { parentActor, requireParent } from '../../plugins/parent';
import { badRequest, notFound, parse } from '../../lib/errors';
import { allocate } from '../../domain/allocate';
import { balancesOf } from '../finance/money';
import { payByCard } from '../payments/card';
import { resultOf } from '../payments/service';
import { documentPdf } from '../receipts/service';
import { saveCard } from '../cards/service';
import { createRequest } from '../requests/service';
import { PORTAL_LIMIT } from './auth-routes';
import { portalView } from './service';

const idParam = z.object({ id: z.string().min(1).max(40) });
const portal = { access: PARENT, rateLimit: PORTAL_LIMIT };

/**
 * Parent portal. The family is taken only from the parent session (requireParent), and every
 * lookup by id is filtered by that family, so ids of another family answer 404.
 */
export async function portalRoutes(app: FastifyInstance) {
  const deps = app.deps;
  const { db } = deps;

  app.get('/api/portal/me', { config: portal }, async (req): Promise<PortalMe> => {
    const p = requireParent(req);
    const view = await portalView(deps, p.familyId, false);
    return { ...view, csrfToken: p.csrfToken, testMode: deps.config.PAYMENT_PROVIDER === 'mock' };
  });

  app.get('/api/portal/receipts/:id/pdf', { config: portal }, async (req, reply) => {
    const p = requireParent(req);
    const { id } = parse(idParam, req.params);
    const r = await db.receipt.findFirst({ where: { id, familyId: p.familyId } });
    if (!r) throw notFound('הקבלה לא נמצאה');
    const { pdf, filename } = await documentPdf(db, r.id);
    return reply
      .header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename="${filename}"`)
      .send(pdf);
  });

  /** "שלם עכשיו": card only, split between the children by the demo's allocation. */
  app.post('/api/portal/pay', { config: portal }, async (req): Promise<PaymentResult> => {
    const p = requireParent(req);
    const input = parse(portalPaySchema, req.body);
    const existing = await db.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) {
      if (existing.familyId !== p.familyId) throw notFound('התשלום לא נמצא');
      return db.$transaction((tx) => resultOf(tx, existing.id));
    }
    const kids = await db.student.findMany({
      where: { familyId: p.familyId, deletedAt: null },
      orderBy: { enrollSeq: 'asc' },
    });
    if (!kids.length) throw notFound('המשפחה לא נמצאה');
    const bal = await balancesOf(
      db,
      kids.map((k) => k.id),
    );
    if ([...bal.values()].reduce((a, b) => a + b, 0) <= 0) throw badRequest('אין יתרה לתשלום');
    const parts = allocate(
      kids.map((k) => ({ studentId: k.id, balanceAgorot: bal.get(k.id) ?? 0 })),
      input.amountAgorot,
    );
    return payByCard(deps, req.log, {
      familyId: p.familyId,
      parts,
      amountAgorot: input.amountAgorot,
      idempotencyKey: input.idempotencyKey,
      cardId: input.cardId,
      newCard: input.newCard,
      actor: parentActor(req),
      source: 'portal',
      createdById: null,
    });
  });

  /** Adds a card without paying, e.g. after the school asked for one for an installments plan (C11). */
  app.post('/api/portal/cards', { config: portal }, async (req) => {
    const p = requireParent(req);
    const { studentId, card } = parse(portalCardSchema, req.body);
    const s = await db.student.findFirst({ where: { id: studentId, familyId: p.familyId, deletedAt: null } });
    if (!s) throw notFound('התלמיד לא נמצא');
    const c = await saveCard(deps, { studentId: s.id, card, actor: parentActor(req) });
    return { cardId: c.id };
  });

  app.post('/api/portal/requests', { config: portal }, async (req) => {
    const p = requireParent(req);
    const input = parse(portalRequestSchema, req.body);
    return createRequest(deps, p.familyId, input, parentActor(req));
  });

  // ---------- staff preview (decision B8: read only) ----------

  app.get('/api/portal-preview/families', { config: { access: staff('req') } }, async () => {
    const fams = await db.family.findMany({
      where: { archivedAt: null, students: { some: { deletedAt: null } } },
      select: { id: true, name: true, parentName: true },
      orderBy: { name: 'asc' },
    });
    return { families: fams };
  });

  app.get('/api/portal-preview/:id', { config: { access: staff('req') } }, async (req) => {
    const { id } = parse(idParam, req.params);
    return portalView(deps, id, true);
  });
}
