import { renderPage } from './render';
import type { Doc, Page } from './types';

export interface ExportSize {
  w: number;
  h: number;
}

function renderToCanvas(page: Page, size: ExportSize, scale: number, instruments: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.round(size.w * scale);
  c.height = Math.round(size.h * scale);
  const ctx = c.getContext('2d')!;
  ctx.scale(scale, scale);
  renderPage(ctx, page, size.w, size.h, { instruments });
  return c;
}

export function download(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export const safeName = (s: string) => (s.trim().replace(/[^\w\-. ]+/g, '').replace(/\s+/g, '-').slice(0, 60) || 'graph');

export async function exportImage(page: Page, size: ExportSize, opts: { type: 'png' | 'jpeg'; scale: number; instruments: boolean; filename: string }) {
  const canvas = renderToCanvas(page, size, opts.scale, opts.instruments);
  const blob: Blob = await new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not create image'))), opts.type === 'png' ? 'image/png' : 'image/jpeg', 0.92)
  );
  download(blob, `${safeName(opts.filename)}.${opts.type === 'png' ? 'png' : 'jpg'}`);
}

/** A4 PDF, one drawing per page, with a small TMP footer. Loaded on demand to keep the first load light. */
export async function exportPDF(
  pages: Page[],
  size: ExportSize,
  opts: { title: string; scale: number; instruments: boolean; orientation: 'auto' | 'portrait' | 'landscape'; footer: boolean }
) {
  const { jsPDF } = await import('jspdf');
  const landscape = opts.orientation === 'auto' ? size.w >= size.h : opts.orientation === 'landscape';
  const pdf = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
  const PW = pdf.internal.pageSize.getWidth(), PH = pdf.internal.pageSize.getHeight();
  const M = 10, headH = 9, footH = opts.footer ? 7 : 0;
  pages.forEach((page, i) => {
    if (i > 0) pdf.addPage('a4', landscape ? 'landscape' : 'portrait');
    const canvas = renderToCanvas(page, size, opts.scale, opts.instruments);
    const availW = PW - 2 * M, availH = PH - 2 * M - headH - footH;
    const k = Math.min(availW / size.w, availH / size.h);
    const w = size.w * k, h = size.h * k;
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12); pdf.setTextColor(26, 43, 74);
    pdf.text(opts.title, M, M + 4);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(110, 120, 140);
    pdf.text(`${page.name}  ·  ${i + 1}/${pages.length}`, PW - M, M + 4, { align: 'right' });
    const x = M + (availW - w) / 2, y = M + headH;
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', x, y, w, h);
    pdf.setDrawColor(200, 205, 215); pdf.rect(x, y, w, h);
    if (opts.footer) { pdf.setFontSize(8); pdf.text('Made with TMP Graphing Studio — The Modern Pedagogues', M, PH - M + 2); }
  });
  pdf.save(`${safeName(opts.title)}.pdf`);
}

export function exportJSON(doc: Doc, title: string) {
  download(new Blob([JSON.stringify({ title, ...doc }, null, 1)], { type: 'application/json' }), `${safeName(title)}.tmpgraph.json`);
}

/** Parses a saved file, tolerating missing fields from older versions. */
export function parseDocFile(text: string): { title: string; doc: Doc } {
  const raw = JSON.parse(text);
  if (!raw || !Array.isArray(raw.pages) || !raw.pages.length) throw new Error('This file is not a Graphing Studio drawing.');
  return { title: String(raw.title || 'Imported drawing'), doc: { version: 1, pages: raw.pages } };
}
