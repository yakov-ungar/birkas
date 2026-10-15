import {
  REQUEST_TYPES,
  formatMoney,
  normalizePhone,
  requestDetailsText,
  type ApprovalForm,
  type ApproveInput,
  type PortalRequestInput,
  type RequestDetails,
  type RequestRow,
  type RequestStatus,
  type RequestType,
} from '@tuition/shared';
import type { ParentRequest } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { Deps } from '../../deps';
import type { Db, Tx } from '../../lib/db';
import { israelDate } from '../../lib/clock';
import { badRequest, conflict, notFound } from '../../lib/errors';
import { recordAudit, type Actor } from '../audit/service';
import { balancesOf, tuitionOf } from '../finance/money';
import { createDiscount } from '../finance/discount';
import { createPlan } from '../plans/create';
import { getSettings } from '../settings/service';
import { isExpiredOn } from '../cards/service';
import { dispatch, enqueue, newBatch, portalLink, voiceLive } from '../messages/service';

const DAY_MS = 86_400_000;
const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * DAY_MS).toISOString().slice(0, 10);

const detailsOf = (r: ParentRequest) => JSON.parse(r.details) as RequestDetails;

// ---------- parent side ----------

/** Records a request from the portal. The family always comes from the parent session. */
export async function createRequest(
  deps: Deps,
  familyId: string,
  input: PortalRequestInput,
  actor: Actor,
): Promise<{ id: string }> {
  const { db, clock } = deps;
  const now = clock.now();
  const kids = await db.student.findMany({
    where: { familyId, deletedAt: null },
    orderBy: { enrollSeq: 'asc' },
  });
  if (!kids.length) throw notFound('המשפחה לא נמצאה');
  let details: RequestDetails;
  let note = '';
  if (input.type === 'installments') {
    const bal = await balancesOf(
      db,
      kids.map((k) => k.id),
    );
    if (![...bal.values()].some((b) => b > 0)) throw badRequest('אין יתרה לפריסה');
    details = { type: 'installments', months: input.months, method: input.method };
    note = input.note ?? '';
  } else if (input.type === 'discount') {
    if (input.studentId && !kids.some((k) => k.id === input.studentId)) throw notFound('התלמיד לא נמצא');
    details = { type: 'discount', pct: input.pct, studentId: input.studentId };
    note = input.note ?? '';
  } else {
    details = { type: 'contact', phone: input.phone, email: input.email ?? '' };
  }
  if (await db.parentRequest.count({ where: { familyId, type: input.type, status: 'pending' } }))
    throw conflict(`כבר יש בקשת ${REQUEST_TYPES[input.type]} שממתינה לטיפול`);
  return db.$transaction(async (tx) => {
    const r = await tx.parentRequest.create({
      data: { familyId, type: input.type, details: JSON.stringify(details), note, createdAt: now },
    });
    await recordAudit(tx, actor, now, {
      action: 'request.create',
      summary: `פורטל הורים: בקשת ${REQUEST_TYPES[input.type]} (${requestDetailsText(details)})`,
      entity: 'ParentRequest',
      entityId: r.id,
      after: r,
    });
    return { id: r.id };
  });
}

// ---------- staff side ----------

async function toRows(db: Db | Tx, rows: ParentRequest[]): Promise<RequestRow[]> {
  const fams = await db.family.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.familyId))] } },
    include: { students: { where: { deletedAt: null }, select: { id: true, fullName: true } } },
  });
  const byId = new Map(fams.map((f) => [f.id, f]));
  return rows.map((r) => {
    const d = detailsOf(r);
    const f = byId.get(r.familyId);
    const kids = f?.students ?? [];
    const studentsLabel =
      d.type === 'discount' && d.studentId
        ? (kids.find((k) => k.id === d.studentId)?.fullName ?? '')
        : kids.map((k) => k.fullName).join(', ');
    return {
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      familyId: r.familyId,
      familyName: f?.name ?? '',
      studentsLabel,
      type: r.type as RequestType,
      details: d,
      detailsText: requestDetailsText(d),
      note: r.note,
      status: r.status as RequestStatus,
      rejectReason: r.rejectReason,
      resultSummary: r.resultSummary,
      decidedByName: r.decidedByName,
    };
  });
}

export async function requestRows(db: Db): Promise<RequestRow[]> {
  const rows = await db.parentRequest.findMany({ orderBy: [{ createdAt: 'desc' }], take: 300 });
  // Pending first, as in the demo's "ממתין" at the top of the list.
  rows.sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending'));
  return toRows(db, rows);
}

async function pendingRequest(db: Db | Tx, id: string) {
  const r = await db.parentRequest.findUnique({ where: { id } });
  if (!r) throw notFound('הבקשה לא נמצאה');
  if (r.status !== 'pending') throw conflict('הבקשה כבר טופלה');
  return r;
}

/** The demo's approval flows, prefilled (decisions C11 and C12). */
export async function approvalForm(deps: Deps, id: string): Promise<ApprovalForm> {
  const { db } = deps;
  const r = await pendingRequest(db, id);
  const [row] = await toRows(db, [r]);
  const d = detailsOf(r);
  const today = israelDate(deps.clock.now());
  const kids = await db.student.findMany({
    where: { familyId: r.familyId, deletedAt: null },
    orderBy: { enrollSeq: 'asc' },
  });
  if (d.type === 'installments') {
    const bal = await balancesOf(
      db,
      kids.map((k) => k.id),
    );
    const cards = await db.savedCard.findMany({
      where: { studentId: { in: kids.map((k) => k.id) }, removedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return {
      request: row!,
      installments: {
        // Demo: the first payment 30 days from today; the staff member may change it (C11).
        startDate: addDays(today, 30),
        count: d.months,
        students: kids
          .filter((k) => (bal.get(k.id) ?? 0) > 0)
          .map((k) => {
            const own = cards.filter(
              (c) => c.studentId === k.id && !isExpiredOn(c.expMonth, c.expYear, today),
            );
            // Demo: card requested but none saved → transfer.
            const method = d.method === 'card' && !own.length ? 'transfer' : d.method;
            return {
              studentId: k.id,
              fullName: k.fullName,
              balanceAgorot: bal.get(k.id) ?? 0,
              method,
              cards: own.map((c) => ({
                id: c.id,
                label: `${c.brand} ****${c.last4}`,
                isDefault: c.isDefault,
              })),
            };
          }),
      },
    };
  }
  if (d.type === 'discount') {
    const { activeYearName } = await getSettings(db);
    const targets = d.studentId ? kids.filter((k) => k.id === d.studentId) : kids;
    const students = [];
    for (const k of targets)
      students.push({
        studentId: k.id,
        fullName: k.fullName,
        tuitionAgorot: await tuitionOf(db, k.id, activeYearName),
        pct: d.pct,
      });
    return { request: row!, discount: { students } };
  }
  const f = await db.family.findUniqueOrThrow({ where: { id: r.familyId } });
  return {
    request: row!,
    contact: { current: { phone: f.phone, email: f.email }, requested: { phone: d.phone, email: d.email } },
  };
}

export async function approveRequest(
  deps: Deps,
  id: string,
  input: ApproveInput,
  o: { actor: Actor; userId: string; userName: string },
) {
  const { db, clock } = deps;
  const now = clock.now();
  const today = israelDate(now);
  return db.$transaction(async (tx) => {
    const r = await pendingRequest(tx, id);
    const d = detailsOf(r);
    const kids = await tx.student.findMany({ where: { familyId: r.familyId, deletedAt: null } });
    const ownKid = (studentId: string) => {
      if (!kids.some((k) => k.id === studentId)) throw badRequest('התלמיד אינו שייך למשפחה המבקשת');
    };
    const done: string[] = [];

    if (d.type === 'installments') {
      if (!input.plans?.length) throw badRequest('יש לבחור לפחות תלמיד אחד לפריסה');
      const bal = await balancesOf(
        tx,
        kids.map((k) => k.id),
      );
      const seen = new Set<string>();
      for (const p of input.plans) {
        ownKid(p.studentId);
        if (seen.has(p.studentId)) throw badRequest('תלמיד מופיע פעמיים');
        seen.add(p.studentId);
        // The amount is the student's balance now, never a number from the browser.
        const amount = bal.get(p.studentId) ?? 0;
        const name = kids.find((k) => k.id === p.studentId)!.fullName;
        if (amount <= 0) throw badRequest(`ל${name} אין יתרה לפריסה`);
        await createPlan(
          deps,
          tx,
          {
            studentId: p.studentId,
            type: 'installments',
            amountAgorot: amount,
            count: p.count,
            startDate: p.startDate,
            method: p.method,
            cardId: p.cardId,
            standingOrder: p.standingOrder,
          },
          {
            idempotencyKey: `request:${r.id}:${p.studentId}`,
            // The parent asked for it in the portal: that request is the recorded consent.
            consentMethod: 'portal',
            actor: o.actor,
            now,
            userId: o.userId,
          },
        );
        done.push(`פריסה ל${name}: ${p.count} תשלומים, ${formatMoney(amount)}`);
      }
    } else if (d.type === 'discount') {
      if (!input.discounts?.length) throw badRequest('יש להזין לפחות הנחה אחת');
      const allowed = d.studentId ? [d.studentId] : kids.map((k) => k.id);
      const { activeYearName } = await getSettings(tx);
      for (const x of input.discounts) {
        ownKid(x.studentId);
        if (!allowed.includes(x.studentId)) throw badRequest('הבקשה אינה כוללת את התלמיד הזה');
        const res = await createDiscount(tx, x, {
          actor: o.actor,
          now,
          today,
          yearName: activeYearName,
          createdById: o.userId,
        });
        done.push(`הנחה ל${res.studentName}: ${formatMoney(res.amountAgorot)}`);
      }
    } else {
      const f = await tx.family.findUniqueOrThrow({ where: { id: r.familyId } });
      const phoneNorm = normalizePhone(d.phone);
      const after = await tx.family.update({
        where: { id: f.id },
        data: { phone: d.phone, phoneNorm, ...(d.email ? { email: d.email } : {}) },
      });
      await recordAudit(tx, o.actor, now, {
        action: 'family.update',
        summary: `עודכנו פרטי קשר של ${f.name} לפי בקשה מהפורטל`,
        entity: 'Family',
        entityId: f.id,
        before: { phone: f.phone, email: f.email },
        after: { phone: after.phone, email: after.email },
      });
      done.push('הפרטים עודכנו');
    }

    const resultSummary = done.join(' · ');
    const upd = await tx.parentRequest.updateMany({
      where: { id: r.id, status: 'pending' },
      data: {
        status: 'approved',
        decidedAt: now,
        decidedById: o.userId,
        decidedByName: o.userName,
        resultSummary,
      },
    });
    if (upd.count !== 1) throw conflict('הבקשה כבר טופלה');
    await recordAudit(tx, o.actor, now, {
      action: 'request.approve',
      summary: `אושרה בקשת ${REQUEST_TYPES[r.type as RequestType]}: ${resultSummary}`,
      entity: 'ParentRequest',
      entityId: r.id,
    });
    return { resultSummary };
  });
}

/** Rejection requires a reason, which is sent to the parent (demo reqReject). */
export async function rejectRequest(
  deps: Deps,
  log: FastifyBaseLogger,
  id: string,
  reason: string,
  o: { actor: Actor; userId: string; userName: string },
) {
  const { db, clock } = deps;
  const now = clock.now();
  const r = await db.$transaction(async (tx) => {
    const r = await pendingRequest(tx, id);
    const upd = await tx.parentRequest.updateMany({
      where: { id: r.id, status: 'pending' },
      data: {
        status: 'rejected',
        rejectReason: reason,
        decidedAt: now,
        decidedById: o.userId,
        decidedByName: o.userName,
      },
    });
    if (upd.count !== 1) throw conflict('הבקשה כבר טופלה');
    await recordAudit(tx, o.actor, now, {
      action: 'request.reject',
      summary: `נדחתה בקשת ${REQUEST_TYPES[r.type as RequestType]}: ${reason}`,
      entity: 'ParentRequest',
      entityId: r.id,
    });
    return r;
  });
  await notifyParent(
    deps,
    log,
    r.familyId,
    `בקשת ה${REQUEST_TYPES[r.type as RequestType]} שלך נדחתה. סיבה: ${reason}`,
    o.userName,
  );
}

/**
 * Manual message to the family (SMS when there is a phone, otherwise email), sent now.
 * Used for the rejection reason and for the "add a card in the portal" link (decision C11).
 */
export async function notifyParent(
  deps: Deps,
  log: FastifyBaseLogger,
  familyId: string,
  text: string,
  byName: string,
) {
  const { db } = deps;
  const f = await db.family.findUniqueOrThrow({ where: { id: familyId } });
  // Email when the family has one; otherwise by phone: SMS if switched on, else a ימות המשיח call.
  // With neither, the message is recorded as not sent, and the office calls (stage 9).
  const byPhone = (await getSettings(db)).textMessaging ? 'sms' : (await voiceLive(db)) ? 'voice' : null;
  const channel = f.email || !f.phone || !byPhone ? 'email' : byPhone;
  const batch = await newBatch(db, {
    at: deps.clock.now(),
    channel,
    source: 'manual',
    template: text,
    createdByName: byName,
    recipientCount: 1,
  });
  await enqueue(deps, db, { familyId, channel, body: text, batchId: batch.id });
  await dispatch(deps, log);
}

export async function sendCardLink(
  deps: Deps,
  log: FastifyBaseLogger,
  id: string,
  o: { actor: Actor; userName: string },
) {
  const r = await pendingRequest(deps.db, id);
  const link = portalLink(deps, r.familyId);
  await notifyParent(
    deps,
    log,
    r.familyId,
    `כדי שנוכל לחייב את הפריסה שביקשת בכרטיס אשראי, יש להוסיף כרטיס בפורטל ההורים: ${link}`,
    o.userName,
  );
  await deps.db.$transaction((tx) =>
    recordAudit(tx, o.actor, deps.clock.now(), {
      action: 'request.card_link',
      summary: 'נשלח להורה קישור להוספת כרטיס בפורטל',
      entity: 'ParentRequest',
      entityId: r.id,
    }),
  );
}
