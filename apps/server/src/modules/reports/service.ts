import {
  CHECK_STATUS,
  DOC_TYPES,
  PAYMENT_METHODS,
  REPORTS,
  type Cell,
  type CheckStatus,
  type ColumnKind,
  type DocType,
  type PaymentMethod,
  type Report,
  type ReportKey,
} from '@tuition/shared';
import type { Db } from '../../lib/db';
import { israelDate } from '../../lib/clock';
import { AGING_LABELS, buildLedger, sumBy } from '../../domain/ledger';
import { planLabel } from '../../domain/schedule';
import { EMPTY, loadMoney, summarize } from '../finance/money';
import { getSettings } from '../settings/service';

export interface ReportFilters {
  from?: string;
  to?: string;
  year?: string;
}

const inRange = (d: string, f: ReportFilters) => (!f.from || d >= f.from) && (!f.to || d <= f.to);
const dateWhere = (f: ReportFilters) =>
  f.from || f.to ? { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } : undefined;

type Col = [string, ColumnKind];

function build(
  key: ReportKey,
  cols: Col[],
  rows: Cell[][],
  filters: ReportFilters,
  extra: Partial<Report> = {},
): Report {
  const moneyCols = cols.map(([, k]) => k === 'money');
  const totals =
    rows.length && moneyCols.some(Boolean)
      ? cols.map(([, k], i) =>
          i === 0 ? 'סה״כ' : k === 'money' ? rows.reduce((a, r) => a + (Number(r[i]) || 0), 0) : null,
        )
      : null;
  return {
    key,
    title: REPORTS[key],
    columns: cols.map(([label, kind]) => ({ label, kind })),
    rows,
    totals,
    filters,
    ...extra,
  };
}

async function names(db: Db) {
  const students = await db.student.findMany({
    where: { deletedAt: null },
    include: { family: { select: { name: true } } },
    orderBy: { enrollSeq: 'asc' },
  });
  return { students, byId: new Map(students.map((s) => [s.id, s])) };
}

/** School years in the order they started (first tuition charge). */
export async function schoolYears(db: Db): Promise<string[]> {
  const rows = await db.charge.groupBy({
    by: ['yearName'],
    where: { type: 'tuition' },
    _min: { date: true },
  });
  const active = (await getSettings(db)).activeYearName;
  const list = rows
    .sort((a, b) => (a._min.date ?? '').localeCompare(b._min.date ?? ''))
    .map((r) => r.yearName);
  return list.includes(active) ? list : [...list, active];
}

export async function runReport(db: Db, key: ReportKey, f: ReportFilters, now: Date): Promise<Report> {
  const today = israelDate(now);
  switch (key) {
    case 'debt': {
      const { students } = await names(db);
      const money = await loadMoney(db);
      const rows = students
        .map((s) => ({ s, m: summarize(money.get(s.id) ?? EMPTY, today) }))
        .filter((x) => x.m.balanceAgorot > 0)
        .sort((a, b) => b.m.balanceAgorot - a.m.balanceAgorot)
        .map(({ s, m }) => [s.fullName, s.family.name, ...m.aging, m.balanceAgorot]);
      return build(
        key,
        [
          ['תלמיד', 'text'],
          ['משפחה', 'text'],
          ...AGING_LABELS.map((l): Col => [l === 'שוטף' ? l : l.replace(' יום', ''), 'money']),
          ['יתרה', 'money'],
        ],
        rows,
        {},
      );
    }

    case 'methods':
    case 'monthly': {
      const pays = await db.payment.findMany({ where: { date: dateWhere(f) } });
      const m = new Map<string, number>();
      for (const p of pays) {
        const k = key === 'methods' ? p.method : p.date.slice(0, 7);
        m.set(k, (m.get(k) ?? 0) + p.amountAgorot);
      }
      const rows =
        key === 'methods'
          ? [...m].map(([k, v]) => [PAYMENT_METHODS[k as PaymentMethod] ?? k, v])
          : [...m]
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => [k.split('-').reverse().join('/'), v]);
      return build(
        key,
        [
          [key === 'methods' ? 'אמצעי' : 'חודש', 'text'],
          ['סכום', 'money'],
        ],
        rows,
        f,
      );
    }

    case 'grades': {
      // Decision C16: per school year. "Paid" is the share of the student's payments that covers
      // that year's charges, oldest year first (the same FIFO order as debt aging).
      const settings = await getSettings(db);
      const years = await schoolYears(db);
      const year = f.year && years.includes(f.year) ? f.year : settings.activeYearName;
      const { students } = await names(db);
      const money = await loadMoney(db);
      const agg = new Map<string, { net: number; paid: number }>();
      for (const s of students) {
        const m = money.get(s.id) ?? EMPTY;
        let left = sumBy(m.credits, (c) => c.amountAgorot);
        let net = 0;
        let paid = 0;
        let has = false;
        for (const y of years) {
          const yc = m.charges.filter((c) => c.yearName === y);
          const n = sumBy(yc, (c) => c.amountAgorot);
          const p = Math.max(0, Math.min(left, n));
          left -= p;
          if (y === year) {
            net = n;
            paid = p;
            has = yc.length > 0;
          }
        }
        if (!has) continue;
        const g = agg.get(s.grade) ?? { net: 0, paid: 0 };
        g.net += net;
        g.paid += paid;
        agg.set(s.grade, g);
      }
      const order = [...settings.grades, ...[...agg.keys()].filter((g) => !settings.grades.includes(g))];
      const rows = order
        .filter((g) => agg.has(g))
        .map((g) => {
          const { net, paid } = agg.get(g)!;
          return [g, net, paid, net - paid, net > 0 ? Math.round((paid / net) * 100) : null];
        });
      return build(
        key,
        [
          ['כיתה', 'text'],
          ['חויב נטו', 'money'],
          ['שולם', 'money'],
          ['יתרה', 'money'],
          ['אחוז גבייה', 'pct'],
        ],
        rows,
        { year },
        { years },
      );
    }

    case 'discounts': {
      const { byId } = await names(db);
      const rows = await db.charge.findMany({
        where: { type: { in: ['disc', 'sib'] }, reversalOfId: null, reversedBy: null, date: dateWhere(f) },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      });
      return build(
        key,
        [
          ['תאריך', 'date'],
          ['תלמיד', 'text'],
          ['תיאור', 'text'],
          ['סכום', 'money'],
        ],
        rows.map((c) => [c.date, byId.get(c.studentId)?.fullName ?? '', c.description, -c.amountAgorot]),
        f,
      );
    }

    case 'failed': {
      const pcs = await db.planCharge.findMany({
        where: { status: 'failed', dueDate: dateWhere(f) },
        include: { plan: { include: { student: { select: { fullName: true } } } } },
        orderBy: { dueDate: 'asc' },
      });
      return build(
        key,
        [
          ['תלמיד', 'text'],
          ['תוכנית', 'text'],
          ['תאריך', 'date'],
          ['סכום', 'money'],
          ['סיבה', 'text'],
        ],
        pcs.map((c) => [
          c.plan.student.fullName,
          planLabel(c.plan.type, c.plan.count, c.plan.count),
          c.dueDate,
          c.amountAgorot,
          c.lastError ?? '',
        ]),
        f,
      );
    }

    case 'checks': {
      const rows = await db.check.findMany({
        where: { dueDate: dateWhere(f) },
        include: { student: { select: { fullName: true } } },
        orderBy: { dueDate: 'asc' },
      });
      return build(
        key,
        [
          ['פירעון', 'date'],
          ['תלמיד', 'text'],
          ['שיק', 'text'],
          ['בנק', 'text'],
          ['סכום', 'money'],
          ['סטטוס', 'text'],
        ],
        rows.map((c) => [
          c.dueDate,
          c.student.fullName,
          c.number,
          c.bank,
          c.amountAgorot,
          CHECK_STATUS[c.status as CheckStatus]?.[0] ?? c.status,
        ]),
        f,
      );
    }

    case 'cash': {
      const time = new Intl.DateTimeFormat('he-IL', {
        timeZone: 'Asia/Jerusalem',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      const rows = (
        await db.cashSession.findMany({ where: { closedAt: { not: null } }, orderBy: { closedAt: 'desc' } })
      )
        .filter((c) => inRange(israelDate(c.closedAt!), f))
        .map((c) => [
          israelDate(c.closedAt!),
          time.format(c.closedAt!),
          c.closedByName ?? '',
          c.expectedAgorot ?? 0,
          c.countedAgorot ?? 0,
          c.diffAgorot ?? 0,
        ]);
      return build(
        key,
        [
          ['תאריך', 'date'],
          ['שעה', 'text'],
          ['על ידי', 'text'],
          ['צפוי', 'money'],
          ['נספר', 'money'],
          ['הפרש', 'money'],
        ],
        rows,
        f,
      );
    }

    case 'accounting': {
      // One line per document and student, signed as in the ledger: the total equals the money
      // the ledger shows as received in the period (credit notes and refunds are negative).
      const { byId } = await names(db);
      const allocs = await db.paymentAllocation.findMany({
        where: { payment: { date: dateWhere(f) } },
        include: { payment: { include: { receipt: true } } },
      });
      allocs.sort(
        (a, b) =>
          a.payment.date.localeCompare(b.payment.date) ||
          +a.payment.createdAt - +b.payment.createdAt ||
          a.id.localeCompare(b.id),
      );
      return build(
        key,
        [
          ['מסמך', 'text'],
          ['מספר', 'number'],
          ['תאריך', 'date'],
          ['תלמיד', 'text'],
          ['משפחה', 'text'],
          ['סכום', 'money'],
          ['אמצעי', 'text'],
          ['אסמכתא', 'text'],
        ],
        allocs.map((a) => {
          const r = a.payment.receipt;
          const s = byId.get(a.studentId);
          return [
            r ? DOC_TYPES[r.docType as DocType] : '',
            r?.number ?? null,
            a.payment.date,
            s?.fullName ?? '',
            s?.family.name ?? '',
            a.amountAgorot,
            PAYMENT_METHODS[a.payment.method as PaymentMethod] ?? a.payment.method,
            a.payment.reference,
          ];
        }),
        f,
      );
    }

    case 'ledger': {
      const { students, byId } = await names(db);
      const money = await loadMoney(db);
      const all = students.map((s) => money.get(s.id) ?? EMPTY);
      const lines = buildLedger(
        all.flatMap((m) => m.charges),
        all.flatMap((m) => m.credits),
      ).filter((l) => inRange(l.date, f));
      return build(
        key,
        [
          ['תאריך', 'date'],
          ['תלמיד', 'text'],
          ['משפחה', 'text'],
          ['תיאור', 'text'],
          ['חובה', 'money'],
          ['זכות', 'money'],
        ],
        lines.map((l) => {
          const s = byId.get(l.studentId);
          return [
            l.date,
            s?.fullName ?? '',
            s?.family.name ?? '',
            l.description,
            l.debitAgorot,
            l.creditAgorot,
          ];
        }),
        f,
      );
    }
  }
}

/** CSV cells: money as plain shekel numbers so Excel can sum them; dates as dd/mm/yyyy. */
export function csvCells(r: Report): { header: string[]; rows: (string | number)[][] } {
  const cell = (v: Cell, kind: ColumnKind): string | number => {
    if (v === null) return '';
    if (kind === 'money') return Number(v) / 100;
    if (kind === 'date') return String(v).split('-').reverse().join('/');
    if (kind === 'pct') return `${v}%`;
    return v;
  };
  const rows = r.rows.map((row) => row.map((v, i) => cell(v, r.columns[i]!.kind)));
  if (r.totals) rows.push(r.totals.map((v, i) => (i === 0 ? String(v) : cell(v, r.columns[i]!.kind))));
  return { header: r.columns.map((c) => c.label), rows };
}
