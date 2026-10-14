import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { REPORTS, reportQuerySchema, type ReportKey } from '@tuition/shared';
import { staff } from '../../plugins/access';
import { actorOf } from '../../plugins/auth';
import { parse } from '../../lib/errors';
import { toCsv } from '../../lib/csv';
import { recordAudit } from '../audit/service';
import { csvCells, runReport } from './service';

const keyParam = z.object({ key: z.enum(Object.keys(REPORTS) as [ReportKey, ...ReportKey[]]) });

export async function reportRoutes(app: FastifyInstance) {
  const { db, clock } = app.deps;

  app.get('/api/reports/:key', { config: { access: staff('rep') } }, async (req) => {
    const { key } = parse(keyParam, req.params);
    return runReport(db, key, parse(reportQuerySchema, req.query), clock.now());
  });

  /** Excel-friendly CSV (UTF-8 with BOM). Every export is written to the audit log. */
  app.get('/api/reports/:key/csv', { config: { access: staff('rep') } }, async (req, reply) => {
    const { key } = parse(keyParam, req.params);
    const f = parse(reportQuerySchema, req.query);
    const r = await runReport(db, key, f, clock.now());
    const { header, rows } = csvCells(r);
    const range = [r.filters.year, r.filters.from, r.filters.to].filter(Boolean).join(' עד ');
    await db.$transaction((tx) =>
      recordAudit(tx, actorOf(req), clock.now(), {
        action: 'report.export',
        summary: `יוצא דוח: ${r.title}${range ? ` (${range})` : ''}`,
        entity: 'Report',
        entityId: key,
      }),
    );
    const name = [key, r.filters.year, r.filters.from, r.filters.to].filter(Boolean).join('_');
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${encodeURIComponent(name)}.csv"`)
      .send(toCsv(header, rows));
  });
}
