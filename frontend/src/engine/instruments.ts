// Traditional drawing instruments: ruler, protractor, 45° and 30-60-90° set squares.
// They live in plot space, so a ruler's centimetres always match the paper's units when you zoom.

import { angleOf, dist, deg, niceStep, pointInPolygon, rotate, sub, v } from './geometry';
import { uid, type Instrument, type InstrumentKind, type Vec, type View } from './types';
import type { Theme } from './paper';

export interface Xf {
  tx: (x: number) => number;
  ty: (y: number) => number;
  ix: (px: number) => number;
  iy: (py: number) => number;
  view: View;
}

export const INSTRUMENT_LABEL: Record<InstrumentKind, string> = {
  ruler: 'Ruler',
  protractor: 'Protractor',
  set45: 'Set square 45°',
  set3060: 'Set square 30°-60°',
};

const SQ3 = Math.sqrt(3);
const FIT = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
function fitSize(x: number) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(x, 0.01))));
  const m = x / p;
  return Math.max(...FIT.filter((f) => f <= m + 1e-9)) * p;
}

export function makeInstrument(kind: InstrumentKind, view: View, w: number, h: number, count: number): Instrument {
  const vw = w / view.sx, vh = h / view.sy;
  const size = kind === 'ruler' ? fitSize(vw * 0.6) : fitSize(Math.min(vw, vh) * (kind === 'protractor' ? 0.55 : 0.5));
  const ox = view.cx - vw * 0.28 + count * 0.06 * vw;
  const oy = view.cy - vh * 0.1 - count * 0.06 * vh;
  return { id: uid('i'), kind, x: kind === 'protractor' ? view.cx : ox, y: oy, angle: 0, size };
}

const rulerWidth = (i: Instrument) => Math.min(i.size * 0.2, 3.2) * (i.size < 3 ? 1 : 1);
const protractorR = (i: Instrument) => i.size / 2;
function squareDims(i: Instrument): [number, number] {
  return i.kind === 'set45' ? [i.size, i.size] : [i.size, i.size / SQ3];
}

export const toWorld = (i: Instrument, l: Vec): Vec => {
  const r = rotate(l, i.angle);
  return v(i.x + r.x, i.y + r.y);
};
export const toLocal = (i: Instrument, p: Vec): Vec => rotate(sub(p, v(i.x, i.y)), -i.angle);

function localPolygon(i: Instrument): Vec[] {
  switch (i.kind) {
    case 'ruler': { const w = rulerWidth(i); return [v(0, 0), v(i.size, 0), v(i.size, w), v(0, w)]; }
    case 'protractor': {
      const R = protractorR(i);
      const pts: Vec[] = [v(-R, -0.1 * R), v(R, -0.1 * R)];
      for (let k = 0; k <= 60; k++) { const a = (k / 60) * Math.PI; pts.push(v(R * Math.cos(a), R * Math.sin(a))); }
      return pts;
    }
    default: { const [a, b] = squareDims(i); return [v(0, 0), v(a, 0), v(0, b)]; }
  }
}

export function hitInstrument(i: Instrument, p: Vec): boolean {
  return pointInPolygon(toLocal(i, p), localPolygon(i));
}

/** Straight edges a pencil can follow. */
export function instrumentEdges(i: Instrument): { a: Vec; b: Vec }[] {
  const W = (x: number, y: number) => toWorld(i, v(x, y));
  switch (i.kind) {
    case 'ruler': { const w = rulerWidth(i); return [{ a: W(0, 0), b: W(i.size, 0) }, { a: W(0, w), b: W(i.size, w) }]; }
    case 'protractor': { const R = protractorR(i); return [{ a: W(-R, 0), b: W(R, 0) }]; }
    default: { const [a, b] = squareDims(i); return [{ a: W(0, 0), b: W(a, 0) }, { a: W(0, 0), b: W(0, b) }, { a: W(a, 0), b: W(0, b) }]; }
  }
}

export function protractorReading(i: Instrument, p: Vec): { outer: number; inner: number } | null {
  if (i.kind !== 'protractor') return null;
  const q = toLocal(i, p);
  if (q.y < 0 || Math.hypot(q.x, q.y) > protractorR(i) * 1.05) return null;
  const a = deg(angleOf(q));
  return { outer: a, inner: 180 - a };
}

/** Local anchor of the rotate handle and the local direction it sticks out in. */
function handleSpec(i: Instrument): { at: Vec; dir: Vec } {
  switch (i.kind) {
    case 'ruler': return { at: v(i.size, rulerWidth(i) / 2), dir: v(1, 0) };
    case 'protractor': return { at: v(0, protractorR(i)), dir: v(0, 1) };
    default: { const [a, b] = squareDims(i); const m = v(a / 2, b / 2); const n = v(b, a); const l = Math.hypot(n.x, n.y); return { at: m, dir: v(n.x / l, n.y / l) }; }
  }
}

export function handleScreen(i: Instrument, xf: Xf): Vec {
  const { at, dir } = handleSpec(i);
  const a = toWorld(i, at);
  const b = toWorld(i, v(at.x + dir.x * 0.01, at.y + dir.y * 0.01));
  const sa = v(xf.tx(a.x), xf.ty(a.y)), sb = v(xf.tx(b.x), xf.ty(b.y));
  const d = v(sb.x - sa.x, sb.y - sa.y);
  const l = Math.hypot(d.x, d.y) || 1;
  return v(sa.x + (d.x / l) * 17, sa.y + (d.y / l) * 17);
}

export function hitHandle(i: Instrument, xf: Xf, px: Vec): boolean {
  return dist(handleScreen(i, xf), px) <= 15;
}

export function drawInstrument(ctx: CanvasRenderingContext2D, i: Instrument, xf: Xf, th: Theme, selected: boolean) {
  const P = (x: number, y: number) => { const w = toWorld(i, v(x, y)); return v(xf.tx(w.x), xf.ty(w.y)); };
  const scale = (xf.view.sx + xf.view.sy) / 2;
  const poly = (pts: Vec[]) => { pts.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); };
  const text = (l: Vec, s: string, size: number, color: string) => {
    const p = P(l.x, l.y);
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(-i.angle); ctx.fillStyle = color;
    ctx.font = `${size}px "Segoe UI", system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(s, 0, 0); ctx.restore();
  };
  const ink = th.dark ? 'rgba(255,255,255,0.9)' : 'rgba(25,35,55,0.9)';
  ctx.save();
  ctx.lineJoin = 'round';
  const body = th.dark ? 'rgba(120,180,255,0.20)' : i.kind === 'ruler' ? 'rgba(255,214,102,0.55)' : 'rgba(110,170,255,0.22)';
  ctx.fillStyle = body;
  ctx.strokeStyle = selected ? '#2f80ed' : ink;
  ctx.lineWidth = selected ? 2 : 1.2;

  if (i.kind === 'ruler') {
    const L = i.size, W = rulerWidth(i);
    ctx.beginPath(); poly(localPolygon(i).map((p) => P(p.x, p.y))); ctx.fill(); ctx.stroke();
    const minor = niceStep(4.5 / scale);
    const major = minor * 10;
    ctx.strokeStyle = ink; ctx.lineWidth = 1;
    ctx.beginPath();
    const n = Math.floor(L / minor + 1e-9);
    if (n < 1500) {
      for (let k = 0; k <= n; k++) {
        const x = k * minor;
        const kind = k % 10 === 0 ? 0.3 : k % 5 === 0 ? 0.2 : 0.12;
        const a = P(x, 0), b = P(x, W * kind); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        const c = P(x, W), d = P(x, W * (1 - kind)); ctx.moveTo(c.x, c.y); ctx.lineTo(d.x, d.y);
      }
    }
    ctx.stroke();
    for (let k = 0; k * major <= L + 1e-9 && k < 200; k++) text(v(k * major, W * 0.5), String(Number((k * major).toFixed(6))), 11, ink);
    text(v(L - 0.9 * Math.min(1, L / 6), W * 0.78), 'cm', 10, ink);
  } else if (i.kind === 'protractor') {
    const R = protractorR(i);
    ctx.beginPath(); poly(localPolygon(i).map((p) => P(p.x, p.y))); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = ink; ctx.lineWidth = 1;
    const pxPerDeg = (R * scale * Math.PI) / 180;
    const stepDeg = pxPerDeg >= 3.2 ? 1 : pxPerDeg >= 1.4 ? 5 : 10;
    ctx.beginPath();
    for (let a = 0; a <= 180; a += stepDeg) {
      const r = (a * Math.PI) / 180;
      const len = a % 10 === 0 ? 0.1 : a % 5 === 0 ? 0.075 : 0.045;
      const p0 = P(R * Math.cos(r), R * Math.sin(r)), p1 = P(R * (1 - len) * Math.cos(r), R * (1 - len) * Math.sin(r));
      ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
    }
    ctx.stroke();
    if (R * scale > 70) for (let a = 0; a <= 180; a += 10) {
      const r = (a * Math.PI) / 180;
      text(v(0.83 * R * Math.cos(r), 0.83 * R * Math.sin(r)), String(a), Math.max(8, Math.min(12, R * scale * 0.05)), ink);
      if (a % 10 === 0 && R * scale > 120) text(v(0.7 * R * Math.cos(r), 0.7 * R * Math.sin(r)), String(180 - a), Math.max(8, Math.min(11, R * scale * 0.045)), th.dark ? '#9cc2ff' : '#2a5db0');
    }
    // baseline and centre cross
    ctx.beginPath(); const l0 = P(-R, 0), l1 = P(R, 0); ctx.moveTo(l0.x, l0.y); ctx.lineTo(l1.x, l1.y);
    const c0 = P(0, 0.06 * R), c1 = P(0, -0.06 * R); ctx.moveTo(c0.x, c0.y); ctx.lineTo(c1.x, c1.y); ctx.stroke();
    ctx.beginPath(); ctx.arc(P(0, 0).x, P(0, 0).y, 3, 0, Math.PI * 2); ctx.stroke();
  } else {
    const [a, b] = squareDims(i);
    const outer = [v(0, 0), v(a, 0), v(0, b)];
    const cx = (a + 0) / 3, cy = b / 3; // centroid
    const inner = outer.map((p) => v(cx + (p.x - cx) * 0.55, cy + (p.y - cy) * 0.55));
    ctx.beginPath(); poly(outer.map((p) => P(p.x, p.y))); poly(inner.map((p) => P(p.x, p.y)));
    ctx.fill('evenodd'); ctx.stroke();
    // right-angle mark and degree labels
    const s = Math.min(a, b) * 0.1;
    ctx.beginPath(); const m0 = P(s, 0), m1 = P(s, s), m2 = P(0, s); ctx.moveTo(m0.x, m0.y); ctx.lineTo(m1.x, m1.y); ctx.lineTo(m2.x, m2.y); ctx.stroke();
    const ang = i.kind === 'set45' ? ['45°', '45°'] : ['30°', '60°'];
    if (Math.min(a, b) * scale > 60) {
      text(v(a * 0.84, b * 0.08), ang[0], 10, ink); // acute angle at (a, 0)
      text(v(a * 0.06, b * 0.84), ang[1], 10, ink); // acute angle at (0, b)
      text(v(a * 0.07, b * 0.1), '90°', 10, ink);
    }
  }

  // rotate handle
  const h = handleScreen(i, xf);
  ctx.beginPath(); ctx.arc(h.x, h.y, 10, 0, Math.PI * 2);
  ctx.fillStyle = selected ? '#2f80ed' : th.dark ? '#2b3f55' : '#ffffff'; ctx.fill();
  ctx.strokeStyle = selected ? '#ffffff' : '#2f80ed'; ctx.lineWidth = 1.6; ctx.stroke();
  ctx.fillStyle = selected ? '#ffffff' : '#2f80ed'; ctx.font = '13px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('↻', h.x, h.y + 0.5);
  ctx.restore();
}
