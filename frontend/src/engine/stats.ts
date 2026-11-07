// Statistical charts. Charts are built as display items in plot space so they sit on real graph
// paper, can be annotated, zoomed and exported exactly like any other drawing.

import { formatNum, niceStep } from './geometry';
import { PALETTE, type ChartConfig, type Vec } from './types';

export type ChartItem =
  | { k: 'rect'; x0: number; y0: number; x1: number; y1: number; fill: string; stroke: string }
  | { k: 'poly'; pts: Vec[]; color: string; width: number; dots?: boolean; dash?: boolean }
  | { k: 'sector'; c: Vec; r: number; a0: number; a1: number; fill: string }
  | { k: 'text'; p: Vec; text: string; size: number; dx?: number; dy?: number; align?: 'center' | 'left' | 'right'; bold?: boolean }
  | { k: 'dot'; p: Vec; r: number; color: string };

export interface Summary {
  n: number; mean: number; median: number; modes: number[]; min: number; max: number;
  range: number; q1: number; q3: number; iqr: number; sd: number;
}

export interface Built {
  items: ChartItem[];
  bounds: { x0: number; y0: number; x1: number; y1: number };
  hideX: boolean;
  hideY: boolean;
  noAxes: boolean;
  summary?: Summary;
  table?: string[][];
  error?: string;
}

export const parseNumbers = (text: string): number[] =>
  text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean).map(Number).filter((n) => Number.isFinite(n));

const lines = (t: string) => t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

export function parsePairs(text: string): { label: string; value: number }[] {
  const out: { label: string; value: number }[] = [];
  for (const l of lines(text)) {
    const m = /^(.*?)[,:;\t=]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(l) ?? /^(.*\S)\s+(-?\d+(?:\.\d+)?)$/.exec(l);
    if (m) out.push({ label: m[1].trim(), value: Number(m[2]) });
  }
  return out;
}

export function parseXY(text: string): Vec[] {
  const out: Vec[] = [];
  for (const l of lines(text)) {
    const p = l.replace(/[()]/g, '').split(/[\s,;]+/).filter(Boolean).map(Number);
    if (p.length >= 2 && p.every(Number.isFinite)) out.push({ x: p[0], y: p[1] });
  }
  return out;
}

export interface Group { lo: number; hi: number; f: number }
/** Lines like "10-20, 5" or "10 – 20 : 5". Returns null if the text is not grouped data. */
export function parseGroups(text: string): Group[] | null {
  const out: Group[] = [];
  for (const l of lines(text)) {
    const m = /^(-?\d+(?:\.\d+)?)\s*[-–—to]+\s*(-?\d+(?:\.\d+)?)\s*[,:;\t ]\s*(\d+(?:\.\d+)?)$/i.exec(l);
    if (!m) return null;
    out.push({ lo: Number(m[1]), hi: Number(m[2]), f: Number(m[3]) });
  }
  return out.length ? out.sort((a, b) => a.lo - b.lo) : null;
}

const median = (s: number[]) => (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2);

export function summarize(data: number[]): Summary | null {
  if (!data.length) return null;
  const s = [...data].sort((a, b) => a - b);
  const n = s.length;
  const mean = s.reduce((a, b) => a + b, 0) / n;
  const half = Math.floor(n / 2);
  const lower = s.slice(0, half), upper = s.slice(n % 2 ? half + 1 : half);
  const q1 = lower.length ? median(lower) : s[0], q3 = upper.length ? median(upper) : s[n - 1];
  const counts = new Map<number, number>();
  for (const x of s) counts.set(x, (counts.get(x) ?? 0) + 1);
  const top = Math.max(...counts.values());
  const modes = top > 1 ? [...counts].filter(([, c]) => c === top).map(([x]) => x) : [];
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  return { n, mean, median: median(s), modes, min: s[0], max: s[n - 1], range: s[n - 1] - s[0], q1, q3, iqr: q3 - q1, sd };
}

const t = (x: number, y: number, text: string, extra: Partial<Extract<ChartItem, { k: 'text' }>> = {}): ChartItem => ({ k: 'text', p: { x, y }, text, size: 13, ...extra });
const fail = (error: string): Built => ({ items: [], bounds: { x0: -1, y0: -1, x1: 1, y1: 1 }, hideX: false, hideY: false, noAxes: false, error });

function histogramBins(cfg: ChartConfig): { groups: Group[]; raw?: number[] } | string {
  const g = parseGroups(cfg.data);
  if (g) return { groups: g };
  const raw = parseNumbers(cfg.data);
  if (raw.length < 2) return 'Enter raw numbers (e.g. 12 15 15 18 …) or grouped data like "10-20, 5" on each line.';
  const min = Math.min(...raw), max = Math.max(...raw);
  const width = cfg.binWidth > 0 ? cfg.binWidth : niceStep((max - min || 1) / (1 + Math.log2(raw.length)));
  const start = Math.floor(min / width) * width;
  const groups: Group[] = [];
  const count = Math.max(1, Math.ceil((max - start) / width - 1e-9));
  for (let i = 0; i < count; i++) {
    const lo = start + i * width;
    const hi = lo + width;
    const last = i === count - 1;
    groups.push({ lo, hi, f: raw.filter((x) => x >= lo && (x < hi || (last && x <= hi))).length });
  }
  return { groups, raw };
}

export function buildChart(cfg: ChartConfig): Built {
  const title = cfg.title ? [t(0, 0, cfg.title, { size: 17, bold: true, align: 'center' })] : [];
  const out = (b: Built, titleAt: { x: number; y: number }): Built => {
    if (cfg.title) { const ti = title[0] as Extract<ChartItem, { k: 'text' }>; ti.p = { x: titleAt.x, y: titleAt.y }; ti.dy = -14; b.items.push(ti); b.bounds.y1 += 0.12 * (b.bounds.y1 - b.bounds.y0); }
    return b;
  };
  const items: ChartItem[] = [];
  switch (cfg.kind) {
    case 'bar':
    case 'line': {
      const rows = parsePairs(cfg.data);
      if (!rows.length) return fail('Enter one "label, value" per line, e.g. Maths, 45');
      const maxV = Math.max(...rows.map((r) => r.value), 1);
      const top = niceStep(maxV / 4) * Math.ceil(maxV / niceStep(maxV / 4));
      const pts: Vec[] = [];
      rows.forEach((r, i) => {
        const x = i + 1;
        if (cfg.kind === 'bar') {
          items.push({ k: 'rect', x0: x - 0.34, x1: x + 0.34, y0: 0, y1: r.value, fill: PALETTE[i % PALETTE.length] + 'cc', stroke: PALETTE[i % PALETTE.length] });
        } else pts.push({ x, y: r.value });
        items.push(t(x, r.value, formatNum(r.value), { dy: -8, align: 'center' }));
        items.push(t(x, 0, r.label, { dy: 18, align: 'center' }));
      });
      if (cfg.kind === 'line') items.push({ k: 'poly', pts, color: PALETTE[1], width: 2.5, dots: true });
      if (cfg.xLabel) items.push(t(rows.length / 2 + 0.5, 0, cfg.xLabel, { dy: 40, align: 'center', bold: true }));
      if (cfg.yLabel) items.push(t(0.2, top, cfg.yLabel, { dy: -10, align: 'left', bold: true }));
      return out({ items, bounds: { x0: -0.2, y0: -top * 0.1, x1: rows.length + 1.2, y1: top * 1.05 }, hideX: true, hideY: false, noAxes: false, table: [['Item', 'Value'], ...rows.map((r) => [r.label, String(r.value)])] }, { x: rows.length / 2 + 0.5, y: top });
    }
    case 'pie': {
      const rows = parsePairs(cfg.data).filter((r) => r.value > 0);
      if (!rows.length) return fail('Enter one "label, value" per line, e.g. Football, 12');
      const total = rows.reduce((a, r) => a + r.value, 0);
      let a = Math.PI / 2;
      const R = 5;
      const table: string[][] = [['Item', 'Value', 'Angle']];
      rows.forEach((r, i) => {
        const sweep = (r.value / total) * Math.PI * 2;
        items.push({ k: 'sector', c: { x: 0, y: 0 }, r: R, a0: a - sweep, a1: a, fill: PALETTE[i % PALETTE.length] });
        const m = a - sweep / 2;
        const deg = (r.value / total) * 360;
        items.push(t(Math.cos(m) * (R + 0.9), Math.sin(m) * (R + 0.9), `${r.label} (${formatNum(deg, 0.1)}°)`, { align: Math.cos(m) >= 0 ? 'left' : 'right' }));
        table.push([r.label, String(r.value), `${formatNum(deg, 0.1)}°`]);
        a -= sweep;
      });
      return out({ items, bounds: { x0: -9, y0: -6.5, x1: 9, y1: 6.5 }, hideX: true, hideY: true, noAxes: true, table }, { x: 0, y: R + 0.6 });
    }
    case 'histogram':
    case 'polygon':
    case 'ogive': {
      const hb = histogramBins(cfg);
      if (typeof hb === 'string') return fail(hb);
      const { groups, raw } = hb;
      const equalWidth = groups.every((g) => Math.abs(g.hi - g.lo - (groups[0].hi - groups[0].lo)) < 1e-9);
      const dens = (g: Group) => (equalWidth ? g.f : g.f / (g.hi - g.lo));
      const xMin = groups[0].lo, xMax = groups[groups.length - 1].hi;
      const maxY = Math.max(...groups.map(dens), 1);
      const table: string[][] = [['Class', 'Frequency', 'Cum. freq']];
      let cum = 0;
      const total = groups.reduce((a, g) => a + g.f, 0);
      groups.forEach((g) => { cum += g.f; table.push([`${g.lo}–${g.hi}`, String(g.f), String(cum)]); });
      const summary = raw ? summarize(raw) ?? undefined : undefined;

      if (cfg.kind === 'histogram') {
        groups.forEach((g, i) => {
          items.push({ k: 'rect', x0: g.lo, x1: g.hi, y0: 0, y1: dens(g), fill: PALETTE[1] + 'aa', stroke: PALETTE[1] });
          items.push(t((g.lo + g.hi) / 2, dens(g), formatNum(dens(g), 0.01), { dy: -7, align: 'center' }));
          void i;
        });
        const top = maxY * 1.12;
        if (cfg.xLabel) items.push(t((xMin + xMax) / 2, 0, cfg.xLabel, { dy: 40, align: 'center', bold: true }));
        items.push(t(xMin, top, cfg.yLabel || (equalWidth ? 'Frequency' : 'Frequency density'), { dy: -4, align: 'left', bold: true }));
        return out({ items, bounds: { x0: xMin - (xMax - xMin) * 0.08, y0: -top * 0.1, x1: xMax + (xMax - xMin) * 0.05, y1: top }, hideX: false, hideY: false, noAxes: false, summary, table }, { x: (xMin + xMax) / 2, y: top });
      }
      if (cfg.kind === 'polygon') {
        const w0 = groups[0].hi - groups[0].lo;
        const pts: Vec[] = [{ x: groups[0].lo - w0 / 2, y: 0 }, ...groups.map((g) => ({ x: (g.lo + g.hi) / 2, y: dens(g) })), { x: groups[groups.length - 1].hi + w0 / 2, y: 0 }];
        groups.forEach((g) => items.push({ k: 'rect', x0: g.lo, x1: g.hi, y0: 0, y1: dens(g), fill: '#00000000', stroke: PALETTE[1] + '55' }));
        items.push({ k: 'poly', pts, color: PALETTE[0], width: 2.6, dots: true });
        const top = maxY * 1.15;
        if (cfg.xLabel) items.push(t((xMin + xMax) / 2, 0, cfg.xLabel, { dy: 40, align: 'center', bold: true }));
        items.push(t(xMin, top, cfg.yLabel || 'Frequency', { dy: -4, align: 'left', bold: true }));
        return out({ items, bounds: { x0: xMin - w0, y0: -top * 0.1, x1: xMax + w0, y1: top }, hideX: false, hideY: false, noAxes: false, summary, table }, { x: (xMin + xMax) / 2, y: top });
      }
      // ogive
      const pts: Vec[] = [{ x: groups[0].lo, y: 0 }];
      let c = 0;
      for (const g of groups) { c += g.f; pts.push({ x: g.hi, y: c }); }
      items.push({ k: 'poly', pts, color: PALETTE[2], width: 2.6, dots: true });
      const at = (target: number) => {
        for (let i = 1; i < pts.length; i++) {
          if (pts[i].y >= target) {
            const a = pts[i - 1], b = pts[i];
            return b.y === a.y ? a.x : a.x + ((target - a.y) / (b.y - a.y)) * (b.x - a.x);
          }
        }
        return xMax;
      };
      const marks: [string, number][] = [['Q1', total / 4], ['Median', total / 2], ['Q3', (3 * total) / 4]];
      const estimates: string[][] = [];
      for (const [name, tv] of marks) {
        const x = at(tv);
        items.push({ k: 'poly', pts: [{ x: xMin, y: tv }, { x, y: tv }, { x, y: 0 }], color: PALETTE[3], width: 1.6, dash: true });
        items.push(t(x, 0, `${name} ≈ ${formatNum(x, 0.01)}`, { dy: 34, align: 'center', bold: true }));
        estimates.push([name, formatNum(x, 0.01)]);
      }
      const top = total * 1.1;
      if (cfg.xLabel) items.push(t((xMin + xMax) / 2, 0, cfg.xLabel, { dy: 52, align: 'center', bold: true }));
      items.push(t(xMin, top, cfg.yLabel || 'Cumulative frequency', { dy: -4, align: 'left', bold: true }));
      return out({ items, bounds: { x0: xMin - (xMax - xMin) * 0.1, y0: -top * 0.1, x1: xMax + (xMax - xMin) * 0.05, y1: top }, hideX: false, hideY: false, noAxes: false, summary, table: [...table, [], ...estimates] }, { x: (xMin + xMax) / 2, y: top });
    }
    case 'scatter': {
      const pts = parseXY(cfg.data);
      if (pts.length < 2) return fail('Enter one "x, y" pair per line (at least 2).');
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const n = pts.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
      const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0), sxy = pts.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0);
      const syy = ys.reduce((a, y) => a + (y - my) ** 2, 0);
      pts.forEach((p) => items.push({ k: 'dot', p, r: 4.5, color: PALETTE[1] }));
      const padX = (x1 - x0 || 1) * 0.15, padY = (y1 - y0 || 1) * 0.2;
      const table: string[][] = [['x', 'y'], ...pts.map((p) => [String(p.x), String(p.y)])];
      if (sxx > 0) {
        const m = sxy / sxx, c = my - m * mx;
        const r = syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
        items.push({ k: 'poly', pts: [{ x: x0 - padX, y: m * (x0 - padX) + c }, { x: x1 + padX, y: m * (x1 + padX) + c }], color: PALETTE[0], width: 2, dash: true });
        items.push(t(x1, m * x1 + c, `y = ${formatNum(m, 0.001)}x ${c < 0 ? '−' : '+'} ${formatNum(Math.abs(c), 0.001)}   (r = ${formatNum(r, 0.001)})`, { dy: -14, dx: -4, align: 'right', bold: true }));
        table.push([], ['Line of best fit', `y = ${formatNum(m, 0.001)}x + ${formatNum(c, 0.001)}`], ['Correlation r', formatNum(r, 0.001)]);
      }
      if (cfg.xLabel) items.push(t((x0 + x1) / 2, y0 - padY, cfg.xLabel, { dy: 40, align: 'center', bold: true }));
      if (cfg.yLabel) items.push(t(x0 - padX, y1 + padY, cfg.yLabel, { dy: -10, align: 'left', bold: true }));
      return out({ items, bounds: { x0: x0 - padX * 2, y0: y0 - padY * 1.5, x1: x1 + padX * 2, y1: y1 + padY * 1.5 }, hideX: false, hideY: false, noAxes: false, table }, { x: (x0 + x1) / 2, y: y1 + padY });
    }
    case 'box': {
      const data = parseNumbers(cfg.data);
      const s = summarize(data);
      if (!s || data.length < 3) return fail('Enter at least 3 numbers separated by spaces or commas.');
      const lo = s.q1 - 1.5 * s.iqr, hi = s.q3 + 1.5 * s.iqr;
      const inside = data.filter((x) => x >= lo && x <= hi);
      const wMin = Math.min(...inside), wMax = Math.max(...inside);
      const y = 1, hh = 0.7;
      items.push({ k: 'poly', pts: [{ x: wMin, y }, { x: s.q1, y }], color: PALETTE[1], width: 2.4 });
      items.push({ k: 'poly', pts: [{ x: s.q3, y }, { x: wMax, y }], color: PALETTE[1], width: 2.4 });
      for (const w of [wMin, wMax]) items.push({ k: 'poly', pts: [{ x: w, y: y - hh / 3 }, { x: w, y: y + hh / 3 }], color: PALETTE[1], width: 2.4 });
      items.push({ k: 'rect', x0: s.q1, x1: s.q3, y0: y - hh / 2, y1: y + hh / 2, fill: PALETTE[1] + '55', stroke: PALETTE[1] });
      items.push({ k: 'poly', pts: [{ x: s.median, y: y - hh / 2 }, { x: s.median, y: y + hh / 2 }], color: PALETTE[0], width: 3 });
      data.filter((x) => x < lo || x > hi).forEach((x) => items.push({ k: 'dot', p: { x, y }, r: 4, color: PALETTE[0] }));
      const labels: [string, number][] = [['Min', wMin], ['Q1', s.q1], ['Median', s.median], ['Q3', s.q3], ['Max', wMax]];
      labels.forEach(([n, x], i) => items.push(t(x, y + hh / 2, `${n} ${formatNum(x, 0.01)}`, { dy: -10 - (i % 2) * 15, align: 'center', size: 12 })));
      const span = s.max - s.min || 1;
      if (cfg.xLabel) items.push(t((s.min + s.max) / 2, 0, cfg.xLabel, { dy: 40, align: 'center', bold: true }));
      return out({ items, bounds: { x0: s.min - span * 0.12, y0: -0.2, x1: s.max + span * 0.12, y1: 2.4 }, hideX: false, hideY: true, noAxes: false, summary: s }, { x: (s.min + s.max) / 2, y: 2 });
    }
  }
}
