import type { FastifyInstance } from 'fastify';
import type { AuditRow } from '@tuition/shared';
import { z } from 'zod';
import { staff } from '../../plugins/access';
import { actorOf } from '../../plugins/auth';
import { parse } from '../../lib/errors';
import { toCsv } from '../../lib/csv';
import { recordAudit } from './service';

const query = z.object({
  q: z.string().trim().max(100).optional(),
  beforeSeq: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const fmt = new Intl.DateTimeFormat('he-IL', {
  timeZone: 'Asia/Jerusalem',
  dateStyle: 'short',
  timeStyle: 'short',
});

export async function auditRoutes(app: FastifyInstance) {
  const { db, clock } = app.deps;

  const where = (q?: string) =>
    q
      ? { OR: [{ summary: { contains: q } }, { actorName: { contains: q } }, { action: { contains: q } }] }
      : {};

  app.get('/api/audit', { config: { access: staff('users') } }, async (req) => {
    const { q, beforeSeq, limit } = parse(query, req.query);
    const rows = await db.auditLog.findMany({
      where: { ...where(q), ...(beforeSeq ? { seq: { lt: beforeSeq } } : {}) },
      orderBy: { seq: 'desc' },
      take: limit,
    });
    const out: (AuditRow & { seq: number })[] = rows.map((r) => ({
      id: r.id,
      seq: r.seq,
      at: r.at.toISOString(),
      actor: r.actorName,
      action: r.action,
      entity: r.entity,
      entityId: r.entityId,
      summary: r.summary,
    }));
    return { rows: out, nextBeforeSeq: rows.length === limit ? rows[rows.length - 1]!.seq : null };
  });

  app.get('/api/audit/export', { config: { access: staff('users') } }, async (req, reply) => {
    const { q } = parse(query, req.query);
    const rows = await db.auditLog.findMany({ where: where(q), orderBy: { seq: 'desc' }, take: 50_000 });
    await db.$transaction((tx) =>
      recordAudit(tx, actorOf(req), clock.now(), {
        action: 'audit.export',
        summary: 'יוצא יומן פעולות',
        entity: 'AuditLog',
      }),
    );
    const csv = toCsv(
      ['מס׳', 'זמן', 'משתמש', 'פעולה', 'תיאור', 'ישות', 'מזהה', 'IP'],
      rows.map((r) => [
        r.seq,
        fmt.format(r.at),
        r.actorName,
        r.action,
        r.summary,
        r.entity,
        r.entityId ?? '',
        r.ip ?? '',
      ]),
    );
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="audit-log.csv"')
      .send(csv);
  });
}
