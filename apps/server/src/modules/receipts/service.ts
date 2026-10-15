import {
  DOC_TYPES,
  PAYMENT_METHODS,
  formatMoney,
  type DocType,
  type PaymentMethod,
  type ReceiptRow,
  type ReceiptView,
} from '@tuition/shared';
import type { Receipt } from '@prisma/client';
import type { Db, Tx } from '../../lib/db';
import { sha256 } from '../../lib/crypto';
import { RtlPdf } from '../../lib/pdf';
import { notFound } from '../../lib/errors';
import type { Deps } from '../../deps';
import { getSettings } from '../settings/service';
import { EMPTY, loadMoney } from '../finance/money';
import { paidItems, type PaidItem } from '../../domain/ledger';

/** Takes the next number for a document type inside the caller's transaction (gap-free, never reused). */
export async function nextNumber(tx: Tx, docType: DocType): Promise<number> {
  const seq = await tx.documentSequence.findUnique({ where: { docType } });
  if (!seq) throw new Error(`missing sequence ${docType}`);
  await tx.documentSequence.update({ where: { docType }, data: { next: seq.next + 1 } });
  return seq.next;
}

export interface IssueInput {
  docType: DocType;
  paymentId: string;
  familyId: string;
  date: string;
  payerName: string;
  amountAgorot: number;
  method: string;
  reference: string;
  lines: { studentId: string; amountAgorot: number }[];
  creditForReceiptId?: string | null;
  reason?: string | null;
}

/** Per student, what this receipt pays (frozen on the document): e.g. tuition, a private lesson. */
async function itemsFor(tx: Tx, input: IssueInput) {
  if (input.docType !== 'receipt') return null;
  const lines = input.lines.filter((l) => l.amountAgorot > 0);
  const money = await loadMoney(
    tx,
    lines.map((l) => l.studentId),
  );
  return lines.map((l) => {
    const m = money.get(l.studentId) ?? EMPTY;
    return {
      studentId: l.studentId,
      items: paidItems(
        m.charges,
        m.credits.filter((c) => c.paymentId !== input.paymentId),
        l.amountAgorot,
      ),
    };
  });
}

export async function issueDocument(tx: Tx, now: Date, input: IssueInput): Promise<Receipt> {
  const number = await nextNumber(tx, input.docType);
  const items = await itemsFor(tx, input);
  const canonical = JSON.stringify([
    input.docType,
    number,
    input.date,
    input.payerName,
    input.amountAgorot,
    input.method,
    input.reference,
    input.lines.map((l) => [l.studentId, l.amountAgorot]),
    input.creditForReceiptId ?? null,
    ...(items ? [items] : []),
  ]);
  return tx.receipt.create({
    data: {
      docType: input.docType,
      number,
      paymentId: input.paymentId,
      familyId: input.familyId,
      date: input.date,
      issuedAt: now,
      payerName: input.payerName,
      amountAgorot: input.amountAgorot,
      method: input.method,
      reference: input.reference,
      creditForReceiptId: input.creditForReceiptId ?? null,
      reason: input.reason ?? null,
      itemsJson: items ? JSON.stringify(items) : null,
      contentSha256: sha256(canonical),
    },
  });
}

type ReceiptWithLinks = Receipt & { creditFor: Receipt | null; creditedBy: Receipt | null };

export function toRow(r: ReceiptWithLinks): ReceiptRow {
  return {
    id: r.id,
    docType: r.docType as DocType,
    number: r.number,
    date: r.date,
    payerName: r.payerName,
    familyId: r.familyId,
    amountAgorot: r.amountAgorot,
    method: r.method as PaymentMethod,
    reference: r.reference,
    cancelled: !!r.creditedBy,
    creditForNumber: r.creditFor?.number ?? null,
    sentAt: r.sentAt?.toISOString() ?? null,
  };
}

export async function receiptView(db: Db | Tx, id: string): Promise<ReceiptView> {
  const r = await db.receipt.findUnique({
    where: { id },
    include: {
      creditFor: true,
      creditedBy: true,
      payment: { include: { allocations: { include: { student: { select: { fullName: true } } } } } },
    },
  });
  if (!r) throw notFound('המסמך לא נמצא');
  const { schoolName } = await getSettings(db);
  const items = new Map(
    (r.itemsJson ? (JSON.parse(r.itemsJson) as { studentId: string; items: PaidItem[] }[]) : []).map((x) => [
      x.studentId,
      x.items,
    ]),
  );
  return {
    ...toRow(r),
    schoolName,
    issuedAt: r.issuedAt.toISOString(),
    printCount: r.printCount,
    cancelledBy: r.creditedBy?.number ?? null,
    lines: r.payment.allocations.map((a) => ({
      studentName: a.student.fullName,
      amountAgorot: Math.abs(a.amountAgorot),
      items: items.get(a.studentId) ?? [],
    })),
  };
}

const fmtDate = (d: string) => d.split('-').reverse().join('/');
const hebrewFmt = new Intl.DateTimeFormat('he-IL-u-ca-hebrew', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Asia/Jerusalem',
});
/** Decision D5: the Hebrew date next to the Gregorian one. A business date is taken at noon UTC (same day in Israel). */
export const hebrewDateOf = (d: string) => hebrewFmt.format(new Date(`${d}T12:00:00Z`));

export async function renderDocumentPdf(v: ReceiptView, mark: 'מקור' | 'העתק נאמן למקור'): Promise<Buffer> {
  const title = `${DOC_TYPES[v.docType]} מס׳ ${v.number}`;
  const pdf = new RtlPdf(title);
  pdf.text(v.schoolName, { size: 16, bold: true });
  pdf.text(mark, { size: 10, align: 'left', color: '#5d7079', gap: 0 });
  pdf.text(title, { size: 14, bold: true, gap: 0.6 });
  pdf.rule();
  const isCredit = v.docType !== 'receipt';
  pdf.text(`תאריך: ${fmtDate(v.date)} (${hebrewDateOf(v.date)})`);
  pdf.text(`${isCredit ? 'הוחזר ל' : 'התקבל מאת'}: ${v.payerName}`);
  pdf.text(`אמצעי: ${PAYMENT_METHODS[v.method] ?? v.method}${v.reference ? ` · ${v.reference}` : ''}`);
  if (v.creditForNumber) pdf.text(`זיכוי לקבלה מס׳ ${v.creditForNumber}`);
  pdf.doc.moveDown(0.5);
  pdf.table(
    [
      { header: 'עבור', width: 3 },
      { header: 'סכום', width: 1.2, align: 'left' },
    ],
    [
      ...v.lines.flatMap((l) => [
        [l.studentName, formatMoney(l.amountAgorot, { fixed: true })],
        // The items each student's part paid, e.g. "שיעור פרטי: גמרא" (a new item on the receipt).
        ...l.items.map((i) => [`   · ${i.description}`, formatMoney(i.amountAgorot, { fixed: true })]),
      ]),
      ['סה״כ', formatMoney(v.amountAgorot, { fixed: true })],
    ],
    { boldLastRow: true },
  );
  if (v.cancelledBy) pdf.text(`הקבלה בוטלה באישור זיכוי מס׳ ${v.cancelledBy}`, { color: '#b3322b' });
  pdf.doc.moveDown(2);
  pdf.text(
    `הופק ממוחשב בתאריך ${new Date(v.issuedAt).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })}`,
    { size: 8, color: '#5d7079' },
  );
  return pdf.end();
}

/** First output of a document is the original; every later one is marked as a copy (decision A2). */
export async function documentPdf(db: Db, id: string): Promise<{ pdf: Buffer; filename: string }> {
  const v = await receiptView(db, id);
  const mark = v.printCount === 0 ? 'מקור' : 'העתק נאמן למקור';
  const pdf = await renderDocumentPdf(v, mark);
  await db.receipt.update({ where: { id }, data: { printCount: { increment: 1 } } });
  return { pdf, filename: `${v.docType}-${v.number}.pdf` };
}

export async function emailDocument(deps: Deps, id: string, to: string) {
  const { pdf, filename } = await documentPdf(deps.db, id);
  const v = await receiptView(deps.db, id);
  const name = `${DOC_TYPES[v.docType]} מס׳ ${v.number}`;
  await deps.mailer.send({
    to,
    subject: `${name} - ${v.schoolName}`,
    text: `שלום ${v.payerName},\n\nמצורף/ת ${name} על סך ${formatMoney(v.amountAgorot, { fixed: true })}.\nתודה,\n${v.schoolName}`,
    attachments: [{ filename, content: pdf, contentType: 'application/pdf' }],
  });
  await deps.db.receipt.update({ where: { id }, data: { sentAt: deps.clock.now(), sentTo: to } });
}
