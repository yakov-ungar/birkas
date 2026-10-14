import PDFDocument from 'pdfkit';
import bidiFactory from 'bidi-js';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const bidi = bidiFactory();
const here = dirname(fileURLToPath(import.meta.url));
const FONT_DIR =
  [resolve(here, '../../assets/fonts'), resolve(here, '../assets/fonts')].find((d) => existsSync(d)) ??
  resolve('assets/fonts');
const FONT_REGULAR = resolve(FONT_DIR, 'IBMPlexSansHebrew-Regular.woff');
const FONT_BOLD = resolve(FONT_DIR, 'IBMPlexSansHebrew-Bold.woff');

const MIRROR: Record<string, string> = {
  '(': ')',
  ')': '(',
  '[': ']',
  ']': '[',
  '{': '}',
  '}': '{',
  '<': '>',
  '>': '<',
};

/**
 * pdfkit lays out every line left-to-right and fontkit then reverses lines that contain
 * Hebrew, without mirroring brackets. So we hand it the Unicode-bidi visual order, reversed,
 * with bracket pairs swapped; the result renders like a browser would show it.
 */
export function heb(s: string): string {
  if (!/[֐-׿]/.test(s)) return s;
  const levels = bidi.getEmbeddingLevels(s, 'rtl');
  const chars = [...s];
  for (const [a, b] of bidi.getReorderSegments(s, levels)) {
    chars.splice(a, b - a + 1, ...chars.slice(a, b + 1).reverse());
  }
  return chars
    .reverse()
    .map((c) => MIRROR[c] ?? c)
    .join('');
}

export interface Column {
  header: string;
  width: number;
  align?: 'right' | 'left' | 'center';
}

export class RtlPdf {
  readonly doc: PDFKit.PDFDocument;
  private readonly chunks: Buffer[] = [];
  readonly left = 50;
  readonly right: number;

  constructor(title: string) {
    this.doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: title, Producer: 'tuition-app' } });
    this.doc.registerFont('regular', FONT_REGULAR);
    this.doc.registerFont('bold', FONT_BOLD);
    this.doc.font('regular');
    this.doc.on('data', (c: Buffer) => this.chunks.push(c));
    this.right = this.doc.page.width - 50;
  }

  get width() {
    return this.right - this.left;
  }

  text(
    s: string,
    opts: {
      size?: number;
      bold?: boolean;
      align?: 'right' | 'left' | 'center';
      color?: string;
      gap?: number;
    } = {},
  ) {
    this.doc
      .font(opts.bold ? 'bold' : 'regular')
      .fontSize(opts.size ?? 11)
      .fillColor(opts.color ?? '#14262e')
      .text(heb(s), this.left, this.doc.y, { width: this.width, align: opts.align ?? 'right', features: [] });
    this.doc.moveDown(opts.gap ?? 0.3);
    return this;
  }

  rule() {
    const y = this.doc.y + 2;
    this.doc.moveTo(this.left, y).lineTo(this.right, y).lineWidth(0.5).strokeColor('#d3dde2').stroke();
    this.doc.y = y + 6;
    return this;
  }

  /** Columns are given in reading order (right to left). */
  table(cols: Column[], rows: string[][], opts: { boldLastRow?: boolean } = {}) {
    const total = cols.reduce((s, c) => s + c.width, 0);
    const scale = this.width / total;
    const draw = (cells: string[], bold: boolean, header = false) => {
      if (this.doc.y > this.doc.page.height - 80) this.doc.addPage();
      const y = this.doc.y;
      let x = this.right;
      this.doc.font(bold ? 'bold' : 'regular').fontSize(10);
      if (header) this.doc.rect(this.left, y - 3, this.width, 18).fill('#f1f5f7');
      this.doc.fillColor('#14262e');
      cols.forEach((c, i) => {
        const w = c.width * scale;
        x -= w;
        this.doc.text(heb(cells[i] ?? ''), x + 4, y, {
          width: w - 8,
          height: 13,
          align: c.align ?? 'right',
          ellipsis: true,
          features: [],
        });
      });
      this.doc.y = y + 18;
      this.doc
        .moveTo(this.left, this.doc.y - 3)
        .lineTo(this.right, this.doc.y - 3)
        .lineWidth(0.3)
        .strokeColor('#d3dde2')
        .stroke();
    };
    draw(
      cols.map((c) => c.header),
      true,
      true,
    );
    rows.forEach((r, i) => draw(r, !!opts.boldLastRow && i === rows.length - 1));
    this.doc.moveDown(0.5);
    return this;
  }

  async end(): Promise<Buffer> {
    const done = new Promise<void>((res) => this.doc.on('end', () => res()));
    this.doc.end();
    await done;
    return Buffer.concat(this.chunks);
  }
}
