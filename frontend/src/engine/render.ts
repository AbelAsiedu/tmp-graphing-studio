import { angleDiff, angleOf, deg, formatNum, sub, unit, v } from './geometry';
import { drawInstrument, type Xf } from './instruments';
import { drawPaper, halo, resolveColor, type Theme } from './paper';
import { keyPoints, plotEquation, type Frame } from './plot';
import { buildChart, type Built, type ChartItem } from './stats';
import { isLogX, isLogY, type Obj, type Page, type Style, type Vec, type View } from './types';

export function makeXf(view: View, w: number, h: number): Xf {
  return {
    view,
    tx: (x) => w / 2 + (x - view.cx) * view.sx,
    ty: (y) => h / 2 - (y - view.cy) * view.sy,
    ix: (px) => view.cx + (px - w / 2) / view.sx,
    iy: (py) => view.cy - (py - h / 2) / view.sy,
  };
}

const chartCache = new Map<string, Built>();
export function chartFor(page: Page): Built | null {
  if (!page.chart) return null;
  const key = JSON.stringify(page.chart);
  let b = chartCache.get(key);
  if (!b) {
    b = buildChart(page.chart);
    if (chartCache.size > 50) chartCache.clear();
    chartCache.set(key, b);
  }
  return b;
}

export interface RenderOpts {
  instruments?: boolean;
  selected?: ReadonlySet<string>;
  selectedInstrument?: string | null;
  /** 0..1 draw-on progress per equation id (teaching animation) */
  anim?: Record<string, number>;
}

export function frameOf(page: Page, w: number, h: number): Frame {
  return { view: page.view, w, h, logX: isLogX(page.paper.kind), logY: isLogY(page.paper.kind), angle: page.angleUnit };
}

export function renderPage(ctx: CanvasRenderingContext2D, page: Page, w: number, h: number, opts: RenderOpts = {}) {
  const built = chartFor(page);
  const th = drawPaper(ctx, page.paper, page.view, w, h, { hideX: built?.hideX, hideY: built?.hideY, noAxes: built?.noAxes });
  const xf = makeXf(page.view, w, h);

  if (built && !built.error) for (const it of built.items) drawChartItem(ctx, it, xf, th);

  // equations -------------------------------------------------------------
  const frame = frameOf(page, w, h);
  const kp = page.equations.some((e) => e.visible && e.keyPoints) ? keyPoints(page.equations, page.params, frame) : null;
  for (const eq of page.equations) {
    if (!eq.visible || !eq.text.trim()) continue;
    const res = plotEquation(eq, page.params, frame, opts.anim?.[eq.id] ?? 1);
    ctx.save();
    if (res.fills.length) {
      ctx.fillStyle = eq.color; ctx.globalAlpha = 0.16; ctx.beginPath();
      for (let i = 0; i < res.fills.length; i += 4) {
        const x0 = xf.tx(res.fills[i]), y0 = xf.ty(res.fills[i + 1]), x1 = xf.tx(res.fills[i + 2]), y1 = xf.ty(res.fills[i + 3]);
        ctx.rect(Math.min(x0, x1) - 0.3, Math.min(y0, y1) - 0.3, Math.abs(x1 - x0) + 0.6, Math.abs(y1 - y0) + 0.6);
      }
      ctx.fill(); ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = eq.color; ctx.lineWidth = eq.width; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (res.dashedBoundary) ctx.setLineDash([8, 6]);
    ctx.beginPath();
    for (const line of res.lines) line.forEach((p, i) => (i ? ctx.lineTo(xf.tx(p.x), xf.ty(p.y)) : ctx.moveTo(xf.tx(p.x), xf.ty(p.y))));
    ctx.stroke();
    ctx.setLineDash([]);
    for (const p of kp?.get(eq.id) ?? []) {
      const sx = xf.tx(p.x), sy = xf.ty(p.y);
      if (sx < -10 || sx > w + 10 || sy < -10 || sy > h + 10) continue;
      ctx.fillStyle = '#ffffff'; ctx.strokeStyle = eq.color; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.arc(sx, sy, 4.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.font = '12px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      halo(ctx, `(${formatNum(p.x, 0.001)}, ${formatNum(p.y, 0.001)})`, sx + 8, sy - 8, th);
    }
    ctx.restore();
  }

  // drawings --------------------------------------------------------------
  for (const o of page.objects) {
    if (o.style.cons && !page.showConstruction) continue;
    if (opts.selected?.has(o.id)) drawObj(ctx, o, xf, th, true);
    drawObj(ctx, o, xf, th, false);
  }

  if (opts.instruments !== false) {
    for (const i of page.instruments) drawInstrument(ctx, i, xf, th, opts.selectedInstrument === i.id);
  }
  return { th, built, xf };
}

// ---------------------------------------------------------------------------- objects

function applyStyle(ctx: CanvasRenderingContext2D, s: Style, th: Theme, halo: boolean) {
  ctx.strokeStyle = halo ? '#2f80ed' : resolveColor(s.color, th);
  ctx.fillStyle = s.fill ? resolveColor(s.fill, th) : 'transparent';
  ctx.lineWidth = halo ? s.width + 7 : s.width;
  ctx.globalAlpha = halo ? 0.28 : s.opacity;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const w = s.width;
  ctx.setLineDash(halo || s.dash === 'solid' ? [] : s.dash === 'dashed' ? [w * 4 + 3, w * 3 + 3] : [1, w * 2.2 + 2]);
}

function arrowHead(ctx: CanvasRenderingContext2D, tip: Vec, from: Vec, width: number) {
  const a = Math.atan2(tip.y - from.y, tip.x - from.x);
  const s = 8 + width * 2;
  ctx.save(); ctx.setLineDash([]); ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x - s * Math.cos(a - 0.4), tip.y - s * Math.sin(a - 0.4));
  ctx.lineTo(tip.x - s * Math.cos(a + 0.4), tip.y - s * Math.sin(a + 0.4));
  ctx.closePath(); ctx.fillStyle = ctx.strokeStyle; ctx.fill(); ctx.restore();
}

export function lineScreenEnds(o: Extract<Obj, { t: 'line' }>, xf: Xf, big = 9000): [Vec, Vec] {
  const A = v(xf.tx(o.a.x), xf.ty(o.a.y)), B = v(xf.tx(o.b.x), xf.ty(o.b.y));
  if (o.ext === 'none') return [A, B];
  const d = unit(sub(B, A));
  return [o.ext === 'both' ? v(A.x - d.x * big, A.y - d.y * big) : A, v(A.x + d.x * big, A.y + d.y * big)];
}

export function drawObj(ctx: CanvasRenderingContext2D, o: Obj, xf: Xf, th: Theme, isHalo: boolean) {
  ctx.save();
  applyStyle(ctx, o.style, th, isHalo);
  const S = (p: Vec) => v(xf.tx(p.x), xf.ty(p.y));
  switch (o.t) {
    case 'stroke': {
      const pts = o.pts.map(S);
      ctx.beginPath();
      if (pts.length === 1) { ctx.arc(pts[0].x, pts[0].y, o.style.width / 2, 0, Math.PI * 2); ctx.fillStyle = ctx.strokeStyle; ctx.fill(); break; }
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2, my = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
      }
      ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
      ctx.stroke();
      break;
    }
    case 'line': {
      const [A, B] = lineScreenEnds(o, xf);
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
      if (!isHalo && o.ext === 'none') {
        if (o.arrow !== 'none') arrowHead(ctx, B, A, o.style.width);
        if (o.arrow === 'both') arrowHead(ctx, A, B, o.style.width);
      }
      break;
    }
    case 'circle': {
      const c = S(o.c);
      ctx.beginPath(); ctx.ellipse(c.x, c.y, Math.max(0.1, o.r * xf.view.sx), Math.max(0.1, o.r * xf.view.sy), 0, 0, Math.PI * 2);
      if (o.style.fill && !isHalo) ctx.fill();
      ctx.stroke();
      break;
    }
    case 'arc': {
      const c = S(o.c);
      ctx.beginPath(); ctx.ellipse(c.x, c.y, Math.max(0.1, o.r * xf.view.sx), Math.max(0.1, o.r * xf.view.sy), 0, -o.a0, -o.a1, true); ctx.stroke();
      break;
    }
    case 'polygon': {
      const pts = o.pts.map(S);
      ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      if (o.closed) ctx.closePath();
      if (o.closed && o.style.fill && !isHalo) ctx.fill();
      ctx.stroke();
      break;
    }
    case 'point': {
      const p = S(o.p);
      ctx.beginPath(); ctx.arc(p.x, p.y, isHalo ? 10 : 3.6, 0, Math.PI * 2);
      ctx.fillStyle = isHalo ? '#2f80ed' : resolveColor(o.style.color, th); ctx.fill();
      if (o.label && !isHalo) {
        ctx.globalAlpha = 1; ctx.font = 'italic 600 15px Georgia, "Times New Roman", serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = resolveColor(o.style.color, th);
        halo(ctx, o.label, p.x + 7, p.y - 7, th);
        ctx.fillStyle = resolveColor(o.style.color, th); ctx.fillText(o.label, p.x + 7, p.y - 7);
      }
      break;
    }
    case 'text': {
      const p = S(o.p);
      ctx.font = `${o.size}px "Segoe UI", system-ui, sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      const lines = o.text.split('\n');
      if (isHalo) {
        const wpx = Math.max(...lines.map((l) => ctx.measureText(l).width));
        ctx.fillStyle = '#2f80ed'; ctx.fillRect(p.x - 4, p.y - o.size, wpx + 8, lines.length * o.size * 1.25 + 4);
        break;
      }
      ctx.globalAlpha = 1; ctx.fillStyle = resolveColor(o.style.color, th);
      lines.forEach((l, i) => ctx.fillText(l, p.x, p.y + i * o.size * 1.25));
      break;
    }
    case 'angle': {
      const V = S(o.v);
      const aa = angleOf(sub(o.a, o.v)), ab = angleOf(sub(o.b, o.v));
      const d = angleDiff(aa, ab);
      const r = 26;
      const value = deg(Math.abs(d));
      ctx.beginPath();
      if (Math.abs(value - 90) < 0.6) {
        const e1 = v(Math.cos(aa), -Math.sin(aa)), e2 = v(Math.cos(ab), -Math.sin(ab));
        const s = r * 0.55;
        ctx.moveTo(V.x + e1.x * s, V.y + e1.y * s); ctx.lineTo(V.x + (e1.x + e2.x) * s, V.y + (e1.y + e2.y) * s); ctx.lineTo(V.x + e2.x * s, V.y + e2.y * s);
      } else ctx.arc(V.x, V.y, r, -aa, -(aa + d), d > 0);
      ctx.stroke();
      if (!isHalo) {
        const m = aa + d / 2;
        ctx.globalAlpha = 1; ctx.font = '600 13px "Segoe UI", system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = resolveColor(o.style.color, th);
        halo(ctx, o.label || `${formatNum(value, 0.1)}°`, V.x + Math.cos(m) * (r + 17), V.y - Math.sin(m) * (r + 17), th);
      }
      break;
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------- charts

function drawChartItem(ctx: CanvasRenderingContext2D, it: ChartItem, xf: Xf, th: Theme) {
  ctx.save();
  const S = (p: Vec) => v(xf.tx(p.x), xf.ty(p.y));
  switch (it.k) {
    case 'rect': {
      const x0 = xf.tx(it.x0), x1 = xf.tx(it.x1), y0 = xf.ty(it.y0), y1 = xf.ty(it.y1);
      ctx.fillStyle = it.fill; ctx.strokeStyle = it.stroke; ctx.lineWidth = 1.6;
      ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
      break;
    }
    case 'poly': {
      const pts = it.pts.map(S);
      ctx.strokeStyle = it.color; ctx.lineWidth = it.width; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      if (it.dash) ctx.setLineDash([7, 5]);
      ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.stroke();
      if (it.dots) { ctx.fillStyle = it.color; for (const p of pts) { ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill(); } }
      break;
    }
    case 'sector': {
      const c = S(it.c);
      ctx.beginPath(); ctx.moveTo(c.x, c.y);
      ctx.ellipse(c.x, c.y, it.r * xf.view.sx, it.r * xf.view.sy, 0, -it.a1, -it.a0, false);
      ctx.closePath(); ctx.fillStyle = it.fill; ctx.fill(); ctx.strokeStyle = th.bg; ctx.lineWidth = 2; ctx.stroke();
      break;
    }
    case 'text': {
      const p = S(it.p);
      ctx.font = `${it.bold ? '700 ' : ''}${it.size}px "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = it.align ?? 'center'; ctx.textBaseline = 'alphabetic';
      halo(ctx, it.text, p.x + (it.dx ?? 0), p.y + (it.dy ?? 0), th);
      break;
    }
    case 'dot': {
      const p = S(it.p);
      ctx.fillStyle = it.color; ctx.strokeStyle = th.bg; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, it.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      break;
    }
  }
  ctx.restore();
}

/** View that frames chart bounds with a margin; `equal` keeps circles round (pie charts). */
export function fitView(b: { x0: number; y0: number; x1: number; y1: number }, w: number, h: number, equal: boolean): View {
  const bw = Math.max(b.x1 - b.x0, 1e-9), bh = Math.max(b.y1 - b.y0, 1e-9);
  let sx = (w * 0.9) / bw, sy = (h * 0.82) / bh;
  if (equal) sx = sy = Math.min(sx, sy);
  return { cx: (b.x0 + b.x1) / 2, cy: (b.y0 + b.y1) / 2, sx, sy };
}
