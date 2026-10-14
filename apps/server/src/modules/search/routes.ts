import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { normalizePhone } from '@tuition/shared';
import { staff } from '../../plugins/access';
import { parse } from '../../lib/errors';
import { hasPerm, todayOf } from '../finance/context';
import { EMPTY, loadMoney, summarize } from '../finance/money';

/** Header search from the demo: student, parent, phone or receipt number. */
export async function searchRoutes(app: FastifyInstance) {
  const deps = app.deps;
  const { db } = deps;

  app.get('/api/search', { config: { access: staff('stu_view') } }, async (req) => {
    const { q } = parse(
      z.object({ q: z.string().trim().min(2, 'יש להזין לפחות 2 תווים').max(80) }),
      req.query,
    );
    const digits = normalizePhone(q);
    const phoneLike = digits.length >= 3 && /^[\d\s\-+()]+$/.test(q);
    const famWhere = {
      OR: [
        { name: { contains: q } },
        { parentName: { contains: q } },
        { phone: { contains: q } },
        ...(phoneLike ? [{ phoneNorm: { contains: digits } }] : []),
      ],
    };
    const [students, families] = await Promise.all([
      db.student.findMany({
        where: { deletedAt: null, OR: [{ fullName: { contains: q } }, { family: famWhere }] },
        include: { family: true },
        take: 20,
      }),
      db.family.findMany({ where: famWhere, take: 20 }),
    ]);
    const money = await loadMoney(
      db,
      students.map((s) => s.id),
    );
    const today = todayOf(deps);
    const canReceipts = hasPerm(req, 'rec') || hasPerm(req, 'pay');
    const receipts =
      canReceipts && /^\d{1,9}$/.test(q)
        ? await db.receipt.findMany({
            where: { number: Number(q) },
            select: { id: true, number: true, docType: true, amountAgorot: true, payerName: true },
          })
        : [];
    return {
      students: students.map((s) => ({
        id: s.id,
        fullName: s.fullName,
        familyName: s.family.name,
        balanceAgorot: summarize(money.get(s.id) ?? EMPTY, today).balanceAgorot,
      })),
      families: families.map((f) => ({ id: f.id, name: f.name, parentName: f.parentName, phone: f.phone })),
      receipts,
    };
  });
}
