import {
  requestDetailsText,
  type PortalView,
  type RequestDetails,
  type RequestStatus,
  type RequestType,
} from '@tuition/shared';
import type { Deps } from '../../deps';
import { israelDate } from '../../lib/clock';
import { notFound } from '../../lib/errors';
import { buildLedger } from '../../domain/ledger';
import { EMPTY, loadMoney, summarize } from '../finance/money';
import { getSettings } from '../settings/service';
import { isExpiredOn } from '../cards/service';

/**
 * What a parent sees (demo rPortal). Every query here is scoped by `familyId`, which callers take
 * from the parent session (or, for the staff preview, from a staff member with the `req` permission).
 */
export async function portalView(deps: Deps, familyId: string, readOnly: boolean): Promise<PortalView> {
  const { db } = deps;
  const f = await db.family.findFirst({
    where: { id: familyId, archivedAt: null },
    include: { students: { where: { deletedAt: null }, orderBy: { enrollSeq: 'asc' } } },
  });
  if (!f) throw notFound('המשפחה לא נמצאה');
  const today = israelDate(deps.clock.now());
  const ids = f.students.map((s) => s.id);
  const money = await loadMoney(db, ids);
  const students = f.students.map((s) => ({
    id: s.id,
    fullName: s.fullName,
    grade: s.grade,
    balanceAgorot: summarize(money.get(s.id) ?? EMPTY, today).balanceAgorot,
  }));
  const all = [...money.values()];
  const ledger = buildLedger(
    all.flatMap((m) => m.charges),
    all.flatMap((m) => m.credits),
  );
  const [receipts, cards, requests, settings] = await Promise.all([
    db.receipt.findMany({
      where: { familyId, docType: 'receipt', creditedBy: null },
      orderBy: { issuedAt: 'desc' },
      take: 4,
    }),
    db.savedCard.findMany({
      where: { removedAt: null, studentId: { in: ids } },
      include: { student: { select: { fullName: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    db.parentRequest.findMany({ where: { familyId }, orderBy: { createdAt: 'desc' }, take: 10 }),
    getSettings(db),
  ]);
  return {
    schoolName: settings.schoolName,
    parentName: f.parentName,
    familyName: f.name,
    balanceAgorot: students.reduce((a, s) => a + s.balanceAgorot, 0),
    students,
    recent: ledger
      .slice(-6)
      .reverse()
      .map((l) => ({
        date: l.date,
        description: l.description,
        debitAgorot: l.debitAgorot,
        creditAgorot: l.creditAgorot,
      })),
    receipts: receipts.map((r) => ({
      id: r.id,
      number: r.number,
      date: r.date,
      amountAgorot: r.amountAgorot,
    })),
    cards: cards.map((c) => ({
      id: c.id,
      studentName: c.student.fullName,
      last4: c.last4,
      brand: c.brand,
      exp: `${String(c.expMonth).padStart(2, '0')}/${String(c.expYear).slice(-2)}`,
      expired: isExpiredOn(c.expMonth, c.expYear, today),
    })),
    requests: requests.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      type: r.type as RequestType,
      detailsText: requestDetailsText(JSON.parse(r.details) as RequestDetails),
      status: r.status as RequestStatus,
      rejectReason: r.rejectReason,
    })),
    hostedFieldsUrl: deps.payments.hostedFieldsUrl(),
    readOnly,
  };
}
