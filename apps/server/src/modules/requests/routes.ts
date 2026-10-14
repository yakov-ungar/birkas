import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { approveSchema, rejectSchema } from '@tuition/shared';
import { staff } from '../../plugins/access';
import { actorOf } from '../../plugins/auth';
import { parse } from '../../lib/errors';
import { approvalForm, approveRequest, rejectRequest, requestRows, sendCardLink } from './service';

const idParam = z.object({ id: z.string().min(1).max(40) });

export async function requestRoutes(app: FastifyInstance) {
  const deps = app.deps;
  const who = (req: FastifyRequest) => ({
    actor: actorOf(req),
    userId: req.auth!.user.id,
    userName: req.auth!.user.name,
  });

  app.get('/api/requests', { config: { access: staff('req') } }, async () => ({
    requests: await requestRows(deps.db),
  }));

  app.get('/api/requests/:id/approval', { config: { access: staff('req') } }, async (req) =>
    approvalForm(deps, parse(idParam, req.params).id),
  );

  app.post('/api/requests/:id/approve', { config: { access: staff('req') } }, async (req) => {
    const { id } = parse(idParam, req.params);
    return approveRequest(deps, id, parse(approveSchema, req.body), who(req));
  });

  app.post('/api/requests/:id/reject', { config: { access: staff('req') } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const { reason } = parse(rejectSchema, req.body);
    await rejectRequest(deps, req.log, id, reason, who(req));
    return { ok: true };
  });

  app.post('/api/requests/:id/card-link', { config: { access: staff('req') } }, async (req) => {
    const { id } = parse(idParam, req.params);
    await sendCardLink(deps, req.log, id, who(req));
    return { ok: true };
  });
}
