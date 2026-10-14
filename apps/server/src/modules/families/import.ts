import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { parse as parseCsv } from 'csv-parse/sync';
import { normalizeGrade, normalizePhone, parseShekels, type ImportReport } from '@tuition/shared';
import { staff } from '../../plugins/access';
import { actorOf } from '../../plugins/auth';
import { badRequest, parse } from '../../lib/errors';
import { recordAudit } from '../audit/service';
import { getSettings } from '../settings/service';
import { recalcSiblings } from '../finance/charges';
import { todayOf } from '../finance/context';
import { createFamily, createStudent } from './routes';

/** Column headers accepted in the import file (decision C6). */
const COLUMNS = {
  name: ['שם תלמיד', 'שם התלמיד', 'תלמיד', 'שם'],
  grade: ['כיתה'],
  parent: ['שם הורה', 'הורה', 'שם ההורה'],
  phone: ['טלפון', 'נייד', 'טלפון הורה'],
  email: ['אימייל', 'מייל', 'דוא"ל', 'דואר אלקטרוני'],
  address: ['כתובת'],
  tuition: ['שכר לימוד', 'סכום'],
} as const;
type Col = keyof typeof COLUMNS;

const bodySchema = z
  .object({
    fileName: z.string().trim().min(1).max(200),
    contentBase64: z.string().min(1).max(7_000_000),
    defaultTuitionAgorot: z.number().int().min(0).max(100_000_000),
  })
  .strict();

const cellText = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    const o = v as { text?: string; result?: unknown; richText?: { text: string }[] };
    if (o.richText) return o.richText.map((r) => r.text).join('');
    if (o.text !== undefined) return String(o.text);
    if (o.result !== undefined) return String(o.result);
  }
  return String(v);
};

export async function readRows(fileName: string, buf: Buffer): Promise<string[][]> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) {
    const text = buf.toString('utf8').replace(/^\uFEFF/, '');
    return parseCsv(text, { relaxColumnCount: true, skipEmptyLines: true, trim: true }) as string[][];
  }
  if (lower.endsWith('.xlsx')) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) return [];
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = row.values as unknown[];
      rows.push(vals.slice(1).map((v) => cellText(v).trim()));
    });
    return rows;
  }
  throw badRequest('יש להעלות קובץ xlsx או csv. קובץ xls ישן יש לשמור מחדש כ-xlsx');
}

export async function importRoutes(app: FastifyInstance) {
  const deps = app.deps;
  const { db, clock } = deps;

  app.post(
    '/api/students/import',
    { config: { access: staff('stu_edit') }, bodyLimit: 10 * 1024 * 1024 },
    async (req): Promise<ImportReport> => {
      const input = parse(bodySchema, req.body);
      const rows = await readRows(input.fileName, Buffer.from(input.contentBase64, 'base64'));
      if (rows.length < 2) throw badRequest('הקובץ ריק או שחסרה שורת כותרות');
      const header = rows[0]!.map((h) => h.trim());
      const idx = {} as Record<Col, number>;
      for (const col of Object.keys(COLUMNS) as Col[]) {
        idx[col] = header.findIndex((h) => (COLUMNS[col] as readonly string[]).includes(h));
      }
      const missing = (['name', 'grade', 'parent', 'phone'] as Col[])
        .filter((c) => idx[c] < 0)
        .map((c) => COLUMNS[c][0]);
      if (missing.length) throw badRequest(`חסרות עמודות חובה: ${missing.join(', ')}`);

      const settings = await getSettings(db);
      const today = todayOf(deps);
      const now = clock.now();
      const actor = actorOf(req);
      const report: ImportReport = { imported: 0, newFamilies: 0, rejected: [] };
      const at = (r: string[], c: Col) => (idx[c] >= 0 ? (r[idx[c]] ?? '').trim() : '');

      await db.$transaction(
        async (tx) => {
          const families = new Map<string, string>(); // phoneNorm -> familyId
          for (const f of await tx.family.findMany({
            where: { archivedAt: null },
            select: { id: true, phoneNorm: true },
          })) {
            if (!families.has(f.phoneNorm)) families.set(f.phoneNorm, f.id);
          }
          const touched = new Set<string>();
          const seen = new Set<string>();
          for (let i = 1; i < rows.length; i++) {
            const r = rows[i]!;
            const rowNo = i + 1;
            const values = r.join(' | ');
            if (r.every((c) => !c)) continue;
            const reject = (reason: string) => report.rejected.push({ row: rowNo, reason, values });
            const name = at(r, 'name');
            const parent = at(r, 'parent');
            const phone = at(r, 'phone');
            const email = at(r, 'email').toLowerCase();
            if (!name) {
              reject('חסר שם תלמיד');
              continue;
            }
            if (!parent) {
              reject('חסר שם הורה');
              continue;
            }
            const phoneNorm = normalizePhone(phone);
            if (phoneNorm.length < 9 || phoneNorm.length > 10) {
              reject('מספר טלפון לא תקין');
              continue;
            }
            const grade = normalizeGrade(at(r, 'grade'), settings.grades);
            if (!grade) {
              reject(`כיתה לא מוכרת: ${at(r, 'grade') || '(ריק)'}`);
              continue;
            }
            if (email && !z.string().email().safeParse(email).success) {
              reject('כתובת אימייל לא תקינה');
              continue;
            }
            let tuition = input.defaultTuitionAgorot;
            const t = at(r, 'tuition');
            if (t) {
              const v = parseShekels(t);
              if (v === null || v < 0) {
                reject('סכום שכר לימוד לא תקין');
                continue;
              }
              tuition = v;
            }
            const dupKey = `${phoneNorm}|${name.replace(/\s+/g, ' ')}`;
            let familyId = families.get(phoneNorm);
            if (seen.has(dupKey)) {
              reject('תלמיד כפול בקובץ');
              continue;
            }
            if (
              familyId &&
              (await tx.student.count({ where: { familyId, fullName: name, deletedAt: null } }))
            ) {
              reject('התלמיד כבר קיים במשפחה זו');
              continue;
            }
            seen.add(dupKey);
            if (!familyId) {
              const fam = await createFamily(tx, name, {
                parentName: parent,
                phone,
                email,
                address: at(r, 'address'),
              });
              familyId = fam.id;
              families.set(phoneNorm, familyId);
              report.newFamilies++;
            }
            await createStudent(tx, {
              familyId,
              fullName: name,
              grade,
              tuitionAgorot: tuition,
              date: today,
              yearName: settings.activeYearName,
              createdById: actor.id,
            });
            touched.add(familyId);
            report.imported++;
          }
          for (const fid of touched) await recalcSiblings(tx, fid, actor, now, today);
          await recordAudit(tx, actor, now, {
            action: 'student.import',
            summary: `יובאו ${report.imported} תלמידים מקובץ (${report.rejected.length} שורות נדחו)`,
            entity: 'Student',
            after: {
              fileName: input.fileName,
              ...report,
              rejected: report.rejected.map((x) => ({ row: x.row, reason: x.reason })),
            },
          });
        },
        { timeout: 60_000 },
      );
      return report;
    },
  );
}
