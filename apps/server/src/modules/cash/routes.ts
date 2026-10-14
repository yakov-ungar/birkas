import type { FastifyInstance } from 'fastify';
import {
  PAYMENT_METHODS,
  cashCloseSchema,
  cashOpenSchema,
  formatMoney,
  type CashState,
  type PaymentMethod,
} from '@tuition/shared';
import { staff } from '../../plugins/access';
import { actorOf } from '../../plugins/auth';
import { AppError, conflict, parse } from '../../lib/errors';
import { recordAudit } from '../audit/service';
import type { Db, Tx } from '../../lib/db';

/** Expected cash = opening float + cash received - cash paid out, while this drawer was open. */
async function openState(db: Db | Tx): Promise<CashState['open']> {
  const s = await db.cashSession.findFirst({ where: { closedAt: null } });
  if (!s) return null;
  const cash = await db.payment.findMany({ where: { cashSessionId: s.id }, select: { amountAgorot: true } });
  const cashIn = cash.reduce((a, p) => a + p.amountAgorot, 0);
  const all = await db.payment.groupBy({
    by: ['method'],
    where: { createdAt: { gte: s.openedAt } },
    _sum: { amountAgorot: true },
    _count: true,
  });
  return {
    id: s.id,
    openedAt: s.openedAt.toISOString(),
    openedBy: s.openedByName,
    openingFloatAgorot: s.openingFloatAgorot,
    cashInAgorot: cashIn,
    expectedAgorot: s.openingFloatAgorot + cashIn,
    transactions: cash.length,
    byMethod: all.map((g) => ({
      method: g.method,
      label: PAYMENT_METHODS[g.method as PaymentMethod] ?? g.method,
      amountAgorot: g._sum.amountAgorot ?? 0,
      count: g._count,
    })),
  };
}

export async function cashRoutes(app: FastifyInstance) {
  const { db, clock } = app.deps;

  app.get('/api/cash', { config: { access: staff('checks') } }, async (): Promise<CashState> => {
    const history = await db.cashSession.findMany({
      where: { closedAt: { not: null } },
      orderBy: { closedAt: 'desc' },
      take: 50,
    });
    return {
      open: await openState(db),
      history: history.map((h) => ({
        id: h.id,
        closedAt: h.closedAt!.toISOString(),
        closedBy: h.closedByName ?? '',
        expectedAgorot: h.expectedAgorot ?? 0,
        countedAgorot: h.countedAgorot ?? 0,
        diffAgorot: h.diffAgorot ?? 0,
        notes: h.notes ?? '',
      })),
    };
  });

  app.post('/api/cash/open', { config: { access: staff('checks') } }, async (req) => {
    const { openingFloatAgorot } = parse(cashOpenSchema, req.body);
    const now = clock.now();
    try {
      return await db.$transaction(async (tx) => {
        if (await tx.cashSession.findFirst({ where: { closedAt: null } })) throw conflict('הקופה כבר פתוחה');
        const s = await tx.cashSession.create({
          data: {
            openedAt: now,
            openedById: req.auth!.user.id,
            openedByName: req.auth!.user.name,
            openingFloatAgorot,
          },
        });
        await recordAudit(tx, actorOf(req), now, {
          action: 'cash.open',
          summary: `נפתחה קופה (יתרת פתיחה ${formatMoney(openingFloatAgorot)})`,
          entity: 'CashSession',
          entityId: s.id,
        });
        return { id: s.id };
      });
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw conflict('הקופה כבר פתוחה'); // the partial unique index caught a race
    }
  });

  app.post('/api/cash/close', { config: { access: staff('checks') } }, async (req) => {
    const input = parse(cashCloseSchema, req.body);
    const now = clock.now();
    return db.$transaction(async (tx) => {
      const st = await openState(tx);
      if (!st) throw conflict('אין קופה פתוחה');
      const diff = input.countedAgorot - st.expectedAgorot;
      if (diff !== 0 && !input.acceptDifference) {
        throw new AppError(409, 'cash_difference', `יש הפרש של ${formatMoney(diff)} בקופה. לסגור בכל זאת?`);
      }
      await tx.cashSession.update({
        where: { id: st.id },
        data: {
          closedAt: now,
          closedById: req.auth!.user.id,
          closedByName: req.auth!.user.name,
          expectedAgorot: st.expectedAgorot,
          countedAgorot: input.countedAgorot,
          diffAgorot: diff,
          notes: input.notes ?? null,
        },
      });
      await recordAudit(tx, actorOf(req), now, {
        action: 'cash.close',
        summary: `נסגרה קופה: צפוי ${formatMoney(st.expectedAgorot)}, נספר ${formatMoney(input.countedAgorot)}${diff ? `, הפרש ${formatMoney(diff)}` : ''}`,
        entity: 'CashSession',
        entityId: st.id,
        after: { expected: st.expectedAgorot, counted: input.countedAgorot, diff },
      });
      return { expectedAgorot: st.expectedAgorot, countedAgorot: input.countedAgorot, diffAgorot: diff };
    });
  });
}
