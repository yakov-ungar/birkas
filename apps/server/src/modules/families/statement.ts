import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { formatMoney, statementSendSchema, type LedgerRow } from '@tuition/shared';
import { staff } from '../../plugins/access';
import { actorOf } from '../../plugins/auth';
import { badRequest, notFound, parse } from '../../lib/errors';
import { dispatch, enqueue, familyVars, newBatch } from '../messages/service';
import { fillTemplate } from '../../domain/templates';
import { RtlPdf } from '../../lib/pdf';
import { recordAudit } from '../audit/service';
import { getSettings } from '../settings/service';
import { buildLedger } from '../../domain/ledger';
import { loadMoney } from '../finance/money';
import { todayOf } from '../finance/context';
import type { Db } from '../../lib/db';

const idParam = z.object({ id: z.string().min(1).max(40) });
const fmtDate = (d: string) => d.split('-').reverse().join('/');

export async function familyStatement(db: Db, familyId: string, today: string) {
  const f = await db.family.findUnique({
    where: { id: familyId },
    include: { students: { where: { deletedAt: null }, orderBy: { enrollSeq: 'asc' } } },
  });
  if (!f) throw notFound('המשפחה לא נמצאה');
  const money = await loadMoney(
    db,
    f.students.map((s) => s.id),
  );
  const names = new Map(f.students.map((s) => [s.id, s.fullName]));
  const all = {
    charges: [...money.values()].flatMap((m) => m.charges),
    credits: [...money.values()].flatMap((m) => m.credits),
  };
  const ledger: LedgerRow[] = buildLedger(all.charges, all.credits).map((l) => ({
    ...l,
    studentName: names.get(l.studentId) ?? '',
  }));
  const { schoolName } = await getSettings(db);
  return {
    schoolName,
    asOf: today,
    family: { id: f.id, name: f.name, parentName: f.parentName, email: f.email },
    ledger,
    balanceAgorot: ledger.length ? ledger[ledger.length - 1]!.balanceAgorot : 0,
  };
}

async function statementPdf(s: Awaited<ReturnType<typeof familyStatement>>) {
  const pdf = new RtlPdf(`דף חשבון - ${s.family.name}`);
  pdf.text(s.schoolName, { size: 16, bold: true });
  pdf.text(`דף חשבון נכון ל-${fmtDate(s.asOf)}`, { size: 12 });
  pdf.text(`עבור: ${s.family.parentName} · ${s.family.name}`, { gap: 0.6 });
  pdf.table(
    [
      { header: 'תאריך', width: 1.1 },
      { header: 'תלמיד', width: 1.5 },
      { header: 'תיאור', width: 3.2 },
      { header: 'חיוב', width: 1.1, align: 'left' },
      { header: 'זיכוי / תשלום', width: 1.2, align: 'left' },
      { header: 'יתרה', width: 1.1, align: 'left' },
    ],
    s.ledger.map((l) => [
      fmtDate(l.date),
      l.studentName,
      l.description + (l.cancelled ? ' (בוטל)' : ''),
      l.debitAgorot ? formatMoney(l.debitAgorot) : '',
      l.creditAgorot ? formatMoney(l.creditAgorot) : '',
      formatMoney(l.balanceAgorot),
    ]),
  );
  pdf.text(`יתרה לתשלום: ${formatMoney(s.balanceAgorot, { fixed: true })}`, { size: 13, bold: true });
  return pdf.end();
}

export async function statementRoutes(app: FastifyInstance) {
  const deps = app.deps;
  const { db, clock } = deps;

  app.get('/api/families/:id/statement', { config: { access: staff('stu_view') } }, async (req) => {
    const { id } = parse(idParam, req.params);
    return familyStatement(db, id, todayOf(deps));
  });

  app.get(
    '/api/families/:id/statement/pdf',
    { config: { access: staff('stu_view') } },
    async (req, reply) => {
      const { id } = parse(idParam, req.params);
      const pdf = await statementPdf(await familyStatement(db, id, todayOf(deps)));
      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', 'inline; filename="statement.pdf"')
        .send(pdf);
    },
  );

  app.post('/api/families/:id/statement/send', { config: { access: staff('stu_view') } }, async (req) => {
    const { id } = parse(idParam, req.params);
    const input = parse(statementSendSchema, req.body);
    const channel = input.channel ?? 'email';
    const s = await familyStatement(db, id, todayOf(deps));
    if (channel === 'email') {
      const pdf = await statementPdf(s);
      await deps.mailer.send({
        to: input.email!,
        subject: `דף חשבון - ${s.schoolName}`,
        text: `שלום ${s.family.parentName},\n\nמצורף דף החשבון נכון ל-${fmtDate(s.asOf)}. יתרה לתשלום: ${formatMoney(s.balanceAgorot, { fixed: true })}.\n\n${s.schoolName}`,
        attachments: [{ filename: 'statement.pdf', content: pdf, contentType: 'application/pdf' }],
      });
    } else {
      // SMS / WhatsApp: a short text with the balance and the portal link (no attachment).
      const template = `שלום {הורה}, דף חשבון נכון ל-${fmtDate(s.asOf)}: יתרה לתשלום {יתרה}. לצפייה ותשלום: {קישור}`;
      const batch = await newBatch(db, {
        channel,
        source: 'manual',
        template,
        createdByName: req.auth!.user.name,
        recipientCount: 1,
      });
      const m = await enqueue(deps, db, {
        familyId: id,
        channel,
        body: fillTemplate(template, await familyVars(deps, db, id)),
        batchId: batch.id,
      });
      await dispatch(deps, req.log);
      const sent = m && (await db.message.findUnique({ where: { id: m.id } }));
      if (!sent || sent.status === 'failed') throw badRequest(sent?.error ?? 'השליחה נכשלה');
    }
    await db.$transaction((tx) =>
      recordAudit(tx, actorOf(req), clock.now(), {
        action: 'statement.send',
        summary: `נשלח דף חשבון ל${s.family.name}`,
        entity: 'Family',
        entityId: id,
      }),
    );
    return { ok: true };
  });
}
