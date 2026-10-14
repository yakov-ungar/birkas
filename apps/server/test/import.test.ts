import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { makeApp, signedIn, type TestCtx, type Agent } from './helpers';
import { newFamily } from './finance-helpers';

let ctx: TestCtx;
let a: Agent;
beforeEach(async () => {
  ctx = await makeApp();
  a = (await signedIn(ctx)).agent;
});
afterEach(() => ctx.close());

const csv = (lines: string[]) => Buffer.from('﻿' + lines.join('\r\n'), 'utf8').toString('base64');
const upload = (fileName: string, contentBase64: string) =>
  a.req('POST', '/api/students/import', { fileName, contentBase64, defaultTuitionAgorot: 960000 });

describe('student import', () => {
  it('imports CSV rows, groups siblings by phone, applies sibling discount and reports rejected rows', async () => {
    await newFamily(a, 'יוסף כהן', 'דוד כהן', '050-1111111');
    const r = await upload(
      'students.csv',
      csv([
        'שם תלמיד,כיתה,שם הורה,טלפון,אימייל,כתובת,שכר לימוד',
        'ישראל מזרחי,ב,חיים מזרחי,050-0000001,,,',
        'רחל מזרחי,ד׳,חיים מזרחי,0500000001,,,9900',
        'אפרים כהן,א,דוד כהן,+972-50-1111111,,,',
        'בלי טלפון,א,מישהו,,,,',
        'כיתה שגויה,ט,מישהו,050-0000009,,,',
        'ישראל מזרחי,ב,חיים מזרחי,050-0000001,,,',
        'יוסף כהן,ג,דוד כהן,050-1111111,,,',
        'מייל רע,א,מישהו,050-0000008,not-an-email,,',
        ',,,,,,',
      ]),
    );
    expect(r.statusCode).toBe(200);
    const rep = r.json();
    expect(rep.imported).toBe(3);
    expect(rep.newFamilies).toBe(1);
    expect(rep.rejected.map((x: { row: number; reason: string }) => [x.row, x.reason])).toEqual([
      [5, 'מספר טלפון לא תקין'],
      [6, 'כיתה לא מוכרת: ט'],
      [7, 'תלמיד כפול בקובץ'],
      [8, 'התלמיד כבר קיים במשפחה זו'],
      [9, 'כתובת אימייל לא תקינה'],
    ]);
    const students = (await a.req('GET', '/api/students?filter=all')).json().students;
    const rachel = students.find((s: { fullName: string }) => s.fullName === 'רחל מזרחי');
    expect(rachel.grade).toBe("ד'");
    expect(rachel.netChargedAgorot).toBe(990000 - 99000); // own tuition, 10% as second child
    const ephraim = students.find((s: { fullName: string }) => s.fullName === 'אפרים כהן');
    expect(ephraim.familyName).toBe('משפחת כהן');
    expect(ephraim.netChargedAgorot).toBe(960000 - 96000);
  });

  it('imports an xlsx file', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('תלמידים');
    ws.addRow(['שם תלמיד', 'כיתה', 'שם הורה', 'טלפון']);
    ws.addRow(['נתן ברק', "א'", 'אלי ברק', '0521234567']);
    ws.addRow(['זאב דהן', 'ה', 'שלום דהן', '052-7654321']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const r = await upload('students.xlsx', buf.toString('base64'));
    expect(r.json()).toMatchObject({ imported: 2, newFamilies: 2, rejected: [] });
  });

  it('explains missing columns and unsupported files in Hebrew', async () => {
    const r = await upload('x.csv', csv(['שם,כיתה', 'א,א']));
    expect(r.statusCode).toBe(400);
    expect(r.json().error.message).toBe('חסרות עמודות חובה: שם הורה, טלפון');
    const x = await upload('old.xls', Buffer.from('x').toString('base64'));
    expect(x.json().error.message).toContain('xlsx');
  });
});
