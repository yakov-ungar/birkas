import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AlertItem, Dashboard } from '@tuition/shared';
import { staff } from '../../plugins/access';
import { todayOf, hasPerm } from '../finance/context';
import { EMPTY, loadMoney, summarize } from '../finance/money';
import { addAging, agingLabel, reversalSets, type AgingBuckets } from '../../domain/ledger';
import { daysLeft } from '../cards/service';
import { promiseInfo } from '../messages/collection';
import type { Deps } from '../../deps';

const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);
const monthKey = (d: string) => d.slice(0, 7);
const monthLabel = (k: string) =>
  new Date(`${k}-01T12:00:00Z`).toLocaleDateString('he-IL', { month: 'long', timeZone: 'UTC' });
const shiftMonth = (k: string, n: number) => {
  const [y, m] = k.split('-').map(Number) as [number, number];
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};

/** The demo's alert center, limited to what the viewer may open. */
export async function alertsFor(deps: Deps, req: FastifyRequest): Promise<AlertItem[]> {
  const { db } = deps;
  const today = todayOf(deps);
  const out: AlertItem[] = [];
  if (hasPerm(req, 'plans')) {
    const failed = await db.planCharge.count({
      where: { status: 'failed', plan: { status: { in: ['active', 'paused'] } } },
    });
    if (failed) out.push({ level: 'bad', text: `${failed} חיובים נכשלו ודורשים טיפול`, path: '/plans' });
    const due = await db.planCharge.count({
      where: { status: 'pending', dueDate: { lte: today }, plan: { status: 'active' } },
    });
    if (due) out.push({ level: 'warn', text: `${due} חיובים הגיע מועדם ועדיין לא בוצעו`, path: '/plans' });
  }
  if (hasPerm(req, 'cards')) {
    const cards = await db.savedCard.findMany({
      where: {
        removedAt: null,
        student: {
          plans: { some: { status: 'active', charges: { some: { status: { in: ['pending', 'failed'] } } } } },
        },
      },
      include: {
        student: {
          select: { fullName: true, plans: { where: { status: 'active' }, select: { cardId: true } } },
        },
      },
    });
    for (const c of cards) {
      if (!c.student.plans.some((p) => p.cardId === c.id)) continue;
      const left = daysLeft(c.expMonth, c.expYear, today);
      if (left <= 0)
        out.push({
          level: 'bad',
          text: `כרטיס ****${c.last4} של ${c.student.fullName} פג תוקף ומשויך לתוכנית`,
          path: '/cards',
        });
      else if (left <= 60)
        out.push({
          level: 'warn',
          text: `כרטיס ****${c.last4} של ${c.student.fullName} יפוג בעוד ${left} ימים`,
          path: '/cards',
        });
    }
  }
  if (hasPerm(req, 'checks')) {
    const overdue = await db.check.count({ where: { status: 'pending', dueDate: { lt: today } } });
    if (overdue)
      out.push({
        level: 'warn',
        text: `${overdue} שיקים עבר מועד הפירעון שלהם ועדיין לא הופקדו`,
        path: '/checks',
      });
    const soon = await db.check.count({
      where: { status: 'pending', dueDate: { gte: today, lte: addDays(today, 7) } },
    });
    if (soon) out.push({ level: 'info', text: `${soon} שיקים לפירעון בשבוע הקרוב`, path: '/checks' });
  }
  if (hasPerm(req, 'bank')) {
    const pending = await db.bankTransaction.count({ where: { status: 'pending' } });
    if (pending) out.push({ level: 'info', text: `${pending} תנועות בנק ממתינות לאישור`, path: '/bank' });
  }
  if (hasPerm(req, 'checks')) {
    const open = await db.cashSession.findFirst({ where: { closedAt: null } });
    const n = open ? await db.payment.count({ where: { cashSessionId: open.id } }) : 0;
    if (n) out.push({ level: 'info', text: `יש ${n} תנועות מזומן שטרם נסגרו בקופה`, path: '/checks' });
  }
  if (hasPerm(req, 'msg')) {
    const soon = new Date(Date.parse(today) + 3 * 86_400_000).toISOString().slice(0, 10);
    const promises = await db.contactNote.findMany({
      where: { type: 'promise', fulfilledAt: null, promiseDate: { lte: soon } },
    });
    let due = 0;
    for (const n of promises) if ((await promiseInfo(db, n, today))?.status !== 'kept') due++;
    if (due)
      out.push({
        level: 'warn',
        text: `${due} הבטחות תשלום מגיעות בימים הקרובים או שעברו`,
        path: '/collection',
      });
    const fams = await db.family.findMany({
      where: { archivedAt: null },
      include: { students: { where: { deletedAt: null }, select: { id: true } } },
    });
    const money = await loadMoney(db);
    const old = fams.filter((f) =>
      f.students.some((s) => summarize(money.get(s.id) ?? EMPTY, today).aging[3] > 0),
    ).length;
    if (old) out.push({ level: 'bad', text: `${old} משפחות עם חוב מעל 90 יום`, path: '/collection' });
  }
  return out;
}

export async function dashboardRoutes(app: FastifyInstance) {
  const deps = app.deps;
  const { db } = deps;

  app.get('/api/alerts', { config: { access: staff() } }, async (req) => ({
    alerts: await alertsFor(deps, req),
  }));

  app.get('/api/dashboard', { config: { access: staff() } }, async (): Promise<Dashboard> => {
    const today = todayOf(deps);
    const [charges, students, families, payments, plans, failed, pendingPlan, pendingChecks, audit] =
      await Promise.all([
        db.charge.findMany({
          select: {
            id: true,
            amountAgorot: true,
            type: true,
            reversalOfId: true,
            studentId: true,
            date: true,
            yearName: true,
            description: true,
            createdAt: true,
          },
        }),
        db.student.findMany({
          where: { deletedAt: null },
          select: { id: true, status: true, familyId: true },
        }),
        db.family.findMany({ where: { archivedAt: null }, select: { id: true, name: true } }),
        db.payment.findMany({ select: { amountAgorot: true, date: true } }),
        db.billingPlan.count({ where: { status: 'active' } }),
        db.planCharge.count({ where: { status: 'failed', plan: { status: { in: ['active', 'paused'] } } } }),
        db.planCharge.findMany({
          where: { status: 'pending', plan: { status: 'active' } },
          select: { dueDate: true, amountAgorot: true },
        }),
        db.check.findMany({ where: { status: 'pending' }, select: { dueDate: true, amountAgorot: true } }),
        db.auditLog.findMany({
          orderBy: { seq: 'desc' },
          take: 6,
          select: { at: true, actorName: true, summary: true },
        }),
      ]);
    const { reversed, reversals } = reversalSets(charges);
    const live = charges.filter((c) => !reversed.has(c.id) && !reversals.has(c.id));
    const net = charges.reduce((s, c) => s + c.amountAgorot, 0);
    const discounts = -live.filter((c) => c.amountAgorot < 0).reduce((s, c) => s + c.amountAgorot, 0);
    const collected = payments.reduce((s, p) => s + p.amountAgorot, 0);

    const money = await loadMoney(db);
    let aging: AgingBuckets = [0, 0, 0, 0];
    const famBal = new Map<string, { bal: number; aging: AgingBuckets }>();
    for (const s of students) {
      const m = summarize(money.get(s.id) ?? EMPTY, today);
      aging = addAging(aging, m.aging);
      const f = famBal.get(s.familyId) ?? { bal: 0, aging: [0, 0, 0, 0] as AgingBuckets };
      f.bal += m.balanceAgorot;
      f.aging = addAging(f.aging, m.aging);
      famBal.set(s.familyId, f);
    }
    const thisMonth = monthKey(today);
    const monthly = Array.from({ length: 6 }, (_, i) => shiftMonth(thisMonth, i - 5)).map((k) => ({
      month: k,
      label: monthLabel(k),
      amountAgorot: payments.filter((p) => monthKey(p.date) === k).reduce((s, p) => s + p.amountAgorot, 0),
    }));
    const forecast = Array.from({ length: 6 }, (_, i) => shiftMonth(thisMonth, i)).map((k) => ({
      month: k,
      label: monthLabel(k),
      amountAgorot:
        pendingPlan.filter((c) => monthKey(c.dueDate) === k).reduce((s, c) => s + c.amountAgorot, 0) +
        pendingChecks.filter((c) => monthKey(c.dueDate) === k).reduce((s, c) => s + c.amountAgorot, 0),
    }));
    const names = new Map(families.map((f) => [f.id, f.name]));
    const topDebtors = [...famBal.entries()]
      .filter(([, v]) => v.bal > 0)
      .sort((a, b) => b[1].bal - a[1].bal)
      .slice(0, 5)
      .map(([id, v]) => ({
        familyId: id,
        name: names.get(id) ?? '',
        balanceAgorot: v.bal,
        agingLabel: agingLabel(v.aging),
      }));
    return {
      kpis: {
        netChargedAgorot: net,
        collectedAgorot: collected,
        openAgorot: net - collected,
        collectionPct: net > 0 ? Math.round((collected / net) * 100) : 0,
        discountsAgorot: discounts,
        activeStudents: students.filter((s) => s.status === 'active').length,
        activePlans: plans,
        failedCharges: failed,
      },
      aging,
      monthly,
      forecast,
      topDebtors,
      activity: audit.map((a) => ({ at: a.at.toISOString(), actor: a.actorName, summary: a.summary })),
    };
  });
}
