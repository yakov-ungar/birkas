import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  formatMoney,
  nedarimStartSchema,
  portalNedarimStartSchema,
  type CardMode,
  type NedarimStart,
  type NedarimStatus,
  type PaymentCreateInput,
} from '@tuition/shared';
import type { Deps } from '../../deps';
import type { Db } from '../../lib/db';
import { PARENT, PUBLIC, staff } from '../../plugins/access';
import { actorOf } from '../../plugins/auth';
import { parentActor, requireParent } from '../../plugins/parent';
import { AppError, badRequest, conflict, notFound, parse } from '../../lib/errors';
import { israelDate } from '../../lib/clock';
import { randomToken } from '../../lib/crypto';
import { recordAudit, type Actor } from '../audit/service';
import { allocate, type Part } from '../../domain/allocate';
import { balancesOf } from '../finance/money';
import {
  NEDARIM_IFRAME_URL,
  NEDARIM_ORIGINS,
  parseCallback,
  transactionFields,
} from '../../providers/payment/nedarim';
import { autoSendReceipt, recordPayment, resultOf } from './service';
import { resolveParts } from './routes';
import { PORTAL_LIMIT } from '../portal/auth-routes';
import { getSettings } from '../settings/service';
import { nedarimConfig } from './nedarim-config';

export async function cardMode(deps: Deps): Promise<CardMode> {
  return (await nedarimConfig(deps))
    ? { mode: 'nedarim', iframeUrl: NEDARIM_IFRAME_URL }
    : { mode: 'hosted', iframeUrl: null };
}

const callbackUrl = (deps: Deps) => `${deps.config.APP_BASE_URL}/api/webhooks/nedarim`;

async function startIntent(
  deps: Deps,
  o: {
    familyId: string;
    parts: Part[];
    amountAgorot: number;
    idempotencyKey: string;
    source: 'staff' | 'portal';
    actor: Actor;
    createdById: string | null;
  },
): Promise<NedarimStart> {
  const { db, clock } = deps;
  const cfg = await nedarimConfig(deps);
  if (!cfg) throw badRequest('נדרים פלוס אינו מחובר במצב ייצור');
  const fam = await db.family.findUniqueOrThrow({ where: { id: o.familyId } });
  const existing = await db.nedarimIntent.findUnique({ where: { idempotencyKey: o.idempotencyKey } });
  if (existing && existing.familyId !== o.familyId) throw conflict('מזהה התשלום כבר בשימוש');
  const intent =
    existing ??
    (await db.$transaction(async (tx) => {
      const id = randomToken(16);
      const txn = await tx.cardTransaction.create({
        data: {
          idempotencyKey: `nedarim:${o.idempotencyKey}`,
          kind: 'charge',
          familyId: o.familyId,
          amountAgorot: o.amountAgorot,
          last4: '',
          status: 'pending',
        },
      });
      const it = await tx.nedarimIntent.create({
        data: {
          id,
          familyId: o.familyId,
          partsJson: JSON.stringify(o.parts),
          amountAgorot: o.amountAgorot,
          idempotencyKey: o.idempotencyKey,
          source: o.source,
          createdById: o.createdById,
          actorJson: JSON.stringify(o.actor),
          cardTxnId: txn.id,
          createdAt: clock.now(),
        },
      });
      await recordAudit(tx, o.actor, clock.now(), {
        action: 'nedarim.start',
        summary: `נפתח תשלום בנדרים פלוס: ${fam.name} ${formatMoney(o.amountAgorot)}`,
        entity: 'NedarimIntent',
        entityId: id,
      });
      return it;
    }));
  if (intent.status !== 'pending') throw conflict('התשלום הזה כבר הסתיים');
  const { schoolName } = await getSettings(db);
  return {
    intentId: intent.id,
    iframeUrl: NEDARIM_IFRAME_URL,
    origins: NEDARIM_ORIGINS,
    transaction: transactionFields(cfg, {
      intentId: intent.id,
      amountAgorot: intent.amountAgorot,
      payerName: fam.parentName,
      phone: fam.phone,
      email: fam.email,
      comment: `${schoolName} - ${fam.name}`.trim(),
      callbackUrl: callbackUrl(deps),
    }),
  };
}

async function intentStatus(db: Db, id: string, familyId?: string): Promise<NedarimStatus> {
  const it = await db.nedarimIntent.findFirst({ where: { id, ...(familyId ? { familyId } : {}) } });
  if (!it) throw notFound('התשלום לא נמצא');
  return {
    status: it.status as NedarimStatus['status'],
    message: it.message,
    result: it.paymentId ? await db.$transaction((tx) => resultOf(tx, it.paymentId!)) : null,
  };
}

/**
 * Nedarim's server callback: the only thing that records the payment (the browser's report is
 * not trusted). Checks the sender's address, the intent, and the amount; a second callback for the
 * same payment changes nothing.
 */
export async function handleCallback(
  deps: Deps,
  log: FastifyBaseLogger,
  payload: Record<string, unknown>,
  ip: string,
): Promise<{ ok: boolean }> {
  const { db, clock } = deps;
  const allowed = deps.config.NEDARIM_CALLBACK_IPS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!allowed.includes(ip)) {
    log.warn({ ip }, 'nedarim callback from an address not allowed');
    throw new AppError(403, 'forbidden', 'forbidden');
  }
  const cb = parseCallback(payload);
  if (!cb.intentId) {
    // Field names only (no values): enough to adjust the parser if Nedarim's format differs.
    log.warn({ keys: Object.keys(payload) }, 'nedarim callback without Param1');
    throw badRequest('missing Param1');
  }
  const intent = await db.nedarimIntent.findUnique({ where: { id: cb.intentId } });
  if (!intent) throw notFound('unknown payment');
  if (intent.status !== 'pending') return { ok: true };
  const now = clock.now();
  const actor = JSON.parse(intent.actorJson) as Actor;

  if (!cb.ok) {
    await db.$transaction(async (tx) => {
      await tx.cardTransaction.update({
        where: { id: intent.cardTxnId },
        data: {
          status: 'declined',
          errorMessageHe: cb.message ?? 'החיוב נכשל',
          providerTxnId: cb.transactionId,
        },
      });
      await tx.nedarimIntent.update({
        where: { id: intent.id },
        data: { status: 'failed', message: cb.message ?? 'החיוב נכשל', completedAt: now },
      });
      await recordAudit(tx, actor, now, {
        action: 'payment.card_failed',
        summary: `חיוב בנדרים פלוס נכשל: ${cb.message ?? ''}`.trim(),
        entity: 'NedarimIntent',
        entityId: intent.id,
      });
    });
    return { ok: true };
  }
  if (cb.amountAgorot !== intent.amountAgorot) {
    log.warn({ intentId: intent.id }, 'nedarim callback amount does not match');
    throw badRequest('amount mismatch');
  }

  const paymentId = await db.$transaction(async (tx) => {
    const fresh = await tx.nedarimIntent.findUniqueOrThrow({ where: { id: intent.id } });
    if (fresh.status !== 'pending') return fresh.paymentId;
    await tx.cardTransaction.update({
      where: { id: intent.cardTxnId },
      data: { status: 'approved', providerTxnId: cb.transactionId, approvalCode: cb.confirmation },
    });
    const ref = [
      'נדרים פלוס',
      cb.last4 ? `****${cb.last4}` : null,
      cb.confirmation ? `אישור ${cb.confirmation}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    const { payment } = await recordPayment(tx, now, actor, {
      familyId: intent.familyId,
      method: 'card',
      amountAgorot: intent.amountAgorot,
      date: israelDate(now),
      reference: ref,
      parts: JSON.parse(intent.partsJson) as Part[],
      idempotencyKey: intent.idempotencyKey,
      source: intent.source as 'staff' | 'portal',
      cardTxnId: intent.cardTxnId,
      createdById: intent.createdById,
    });
    await tx.nedarimIntent.update({
      where: { id: intent.id },
      data: {
        status: 'paid',
        paymentId: payment.id,
        providerTxnId: cb.transactionId,
        last4: cb.last4,
        completedAt: now,
      },
    });
    return payment.id;
  });
  const r = paymentId ? await db.receipt.findUnique({ where: { paymentId } }) : null;
  if (r) await autoSendReceipt(deps, log, intent.familyId, r.id);
  return { ok: true };
}

export async function nedarimRoutes(app: FastifyInstance) {
  const deps = app.deps;
  const { db } = deps;
  const idParam = z.object({ id: z.string().min(10).max(40) });

  app.get('/api/payments/card-mode', { config: { access: staff('pay') } }, async () => cardMode(deps));

  app.post('/api/payments/nedarim', { config: { access: staff('pay') } }, async (req) => {
    const input = parse(nedarimStartSchema, req.body);
    const { familyId, parts } = await resolveParts(deps, input as unknown as PaymentCreateInput);
    return startIntent(deps, {
      familyId,
      parts,
      amountAgorot: input.amountAgorot,
      idempotencyKey: input.idempotencyKey,
      source: 'staff',
      actor: actorOf(req),
      createdById: req.auth!.user.id,
    });
  });

  app.get('/api/payments/nedarim/:id', { config: { access: staff('pay') } }, async (req) =>
    intentStatus(db, parse(idParam, req.params).id),
  );

  const portal = { access: PARENT, rateLimit: PORTAL_LIMIT };
  app.get('/api/portal/card-mode', { config: portal }, async () => cardMode(deps));

  app.post('/api/portal/pay/nedarim', { config: portal }, async (req) => {
    const p = requireParent(req);
    const input = parse(portalNedarimStartSchema, req.body);
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
    return startIntent(deps, {
      familyId: p.familyId,
      parts: allocate(
        kids.map((k) => ({ studentId: k.id, balanceAgorot: bal.get(k.id) ?? 0 })),
        input.amountAgorot,
      ),
      amountAgorot: input.amountAgorot,
      idempotencyKey: input.idempotencyKey,
      source: 'portal',
      actor: parentActor(req),
      createdById: null,
    });
  });

  app.get('/api/portal/pay/nedarim/:id', { config: portal }, async (req) =>
    intentStatus(db, parse(idParam, req.params).id, requireParent(req).familyId),
  );

  // Nedarim's server-to-server callback. Its body may come as JSON under a non-standard content
  // type, or as a form: read it raw in this scope only (the rest of the API stays JSON-only).
  await app.register(async (scope) => {
    scope.addContentTypeParser('*', { parseAs: 'string', bodyLimit: 64 * 1024 }, (_req, body, done) =>
      done(null, body),
    );
    scope.post(
      '/api/webhooks/nedarim',
      { config: { access: PUBLIC, rateLimit: { max: 120, timeWindow: '1 minute' } } },
      async (req) => {
        const raw = req.body;
        let payload: Record<string, unknown> = {};
        if (raw && typeof raw === 'object') payload = raw as Record<string, unknown>;
        else if (typeof raw === 'string' && raw.trim()) {
          try {
            payload = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            payload = Object.fromEntries(new URLSearchParams(raw));
          }
        }
        return handleCallback(deps, req.log, payload, req.ip);
      },
    );
  });
}
