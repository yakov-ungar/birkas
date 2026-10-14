import { describe, expect, it } from 'vitest';
import { heb } from '../src/lib/pdf';
import { renderDocumentPdf } from '../src/modules/receipts/service';

describe('Hebrew PDF text', () => {
  it('feeds pdfkit the reversed visual order with mirrored brackets (verified visually against a rendered receipt)', () => {
    expect(heb('abc 123')).toBe('abc 123'); // no Hebrew: untouched
    // pdfkit/fontkit reverses each Hebrew line again without mirroring, so these render correctly.
    expect(heb('קבלה מס׳ 3001')).toBe('קבלה מס׳ 1003');
    expect(heb('תאריך: 14/10/2026')).toBe('תאריך: 6202/01/41');
    expect(heb('אפרים (כיתה א)')).toBe('אפרים )כיתה א(');
  });

  it('renders a receipt PDF with the embedded Hebrew font', async () => {
    const pdf = await renderDocumentPdf(
      {
        id: 'x',
        docType: 'receipt',
        number: 3001,
        date: '2026-10-14',
        payerName: 'דוד כהן',
        familyId: 'f',
        amountAgorot: 960000,
        method: 'cash',
        reference: '',
        cancelled: false,
        creditForNumber: null,
        sentAt: null,
        schoolName: 'בית ספר',
        issuedAt: new Date().toISOString(),
        printCount: 0,
        cancelledBy: null,
        lines: [{ studentName: 'יוסף כהן', amountAgorot: 960000 }],
      },
      'מקור',
    );
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain('IBMPlexSansHebrew');
  });
});
