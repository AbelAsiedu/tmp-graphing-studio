import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { add, angleDiff, angleOf, deg, dist, distToSegment, formatNum, letterLabel, niceStep, sub, v, dot } from '../engine/geometry';
import { eraseAlong } from '../engine/erase';
import { hitObj, snapTargets, translateObj } from '../engine/hit';
import { hitHandle, hitInstrument, instrumentEdges, protractorReading, type Xf } from '../engine/instruments';
import { THEMES, resolveColor } from '../engine/paper';
import { compileEquation, paramDefaults } from '../engine/plot';
import { chartFor, drawObj, fitView, makeXf, renderPage } from '../engine/render';
import { TOOL_BY_ID } from '../engine/constructions';
import { defaultStyle, isLogX, isLogY, newPage, uid, type NewObj, type Obj, type Style, type Vec } from '../engine/types';
import { store, useStore } from '../store';
import { TOOLS, type ToolId, type ToolOpts } from '../toolTypes';

export interface StageHandle {
  zoom: (factor: number) => void;
  fit: () => void;
  animate: (equationId: string) => void;
  size: () => { w: number; h: number };
}

interface Props {
  tool: ToolId;
  opts: ToolOpts;
  selection: ReadonlySet<string>;
  setSelection: (s: Set<string>) => void;
  selInst: string | null;
  setSelInst: (id: string | null) => void;
  spotlight: boolean;
  toast: (msg: string) => void;
  handle: Ref<StageHandle>;
}

type Edge = { a: Vec; b: Vec };
type Drag =
  | { k: 'pan'; last: Vec }
  | { k: 'stroke'; pts: Vec[]; edge: Edge | null; hl: boolean }
  | { k: 'shape'; a: Vec; b: Vec; edge: Edge | null }
  | { k: 'sweep'; c: Vec; r: number; a0: number; last: number; sweep: number; moved: boolean; down: Vec }
  | { k: 'move'; last: Vec }
  | { k: 'inst-move'; id: string; last: Vec }
  | { k: 'inst-rot'; id: string; ang0: number; a0: number }
  | { k: 'erase'; last: Vec }
  | { k: 'laser' };

const DRAW_TOOLS: ToolId[] = ['pen', 'highlighter', 'line', 'arrow'];
const BODY_DRAG_TOOLS: ToolId[] = ['select', 'pan', 'pen', 'highlighter', 'line', 'arrow'];

export const fillFor = (color: string) => (color === 'auto' ? 'rgba(90,130,200,0.18)' : color.length === 7 ? color + '30' : color);

export function CanvasStage({ tool, opts, selection, setSelection, selInst, setSelInst, spotlight, toast, handle }: Props) {
  useStore();
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const status = useRef<HTMLDivElement>(null);
  const size = useRef({ w: 800, h: 600, dpr: 1 });
  const drag = useRef<Drag | null>(null);
  const seq = useRef<Vec[]>([]);
  const compassCenter = useRef<Vec | null>(null);
  const hover = useRef<Vec | null>(null);
  const laser = useRef<{ x: number; y: number; t: number }[]>([]);
  const pointers = useRef(new Map<number, Vec>());
  const gesture = useRef<{ d0: number; mid: Vec; view: { cx: number; cy: number; sx: number; sy: number } } | null>(null);
  const anim = useRef<Record<string, number>>({});
  const space = useRef(false);
  const raf = useRef(0);
  const [, setHintTick] = useState(0); // re-render the hint line as multi-click tools collect points
  const [textEdit, setTextEdit] = useState<{ at: Vec; id?: string; value: string; size: number } | null>(null);

  const page = store.page;
  const live = useRef({ tool, opts, selection, selInst, spotlight });
  live.current = { tool, opts, selection, selInst, spotlight };

  // ------------------------------------------------------------------ helpers
  const xf = (): Xf => makeXf(store.page.view, size.current.w, size.current.h);
  const toPlot = (p: Vec) => { const x = xf(); return v(x.ix(p.x), x.iy(p.y)); };
  const toScreen = (q: Vec) => { const x = xf(); return v(x.tx(q.x), x.ty(q.y)); };
  const logPaper = () => isLogX(store.page.paper.kind) || isLogY(store.page.paper.kind);

  const gridMinor = () => {
    const pg = store.page, vw = pg.view;
    const f = (scale: number) => {
      const step = niceStep(70 / scale);
      const m = step / Math.pow(10, Math.floor(Math.log10(step)));
      const sub = pg.paper.kind === 'millimetre' ? 10 : m === 2 ? 4 : 5;
      let minor = step / sub;
      if (minor * scale < 8) minor = step;
      return minor;
    };
    return { gx: f(vw.sx), gy: f(vw.sy) };
  };

  const snap = (P: Vec, wp: Vec): Vec => {
    for (const q of snapTargets(store.page.objects)) if (dist(toScreen(q), P) < 10) return q;
    if (!live.current.opts.snap || logPaper()) return wp;
    const { gx, gy } = gridMinor();
    return v(Math.round(wp.x / gx) * gx, Math.round(wp.y / gy) * gy);
  };

  const findEdge = (P: Vec): Edge | null => {
    for (const inst of store.page.instruments) {
      for (const e of instrumentEdges(inst)) if (distToSegment(P, toScreen(e.a), toScreen(e.b)) <= 12) return e;
    }
    return null;
  };
  const onEdge = (e: Edge, wp: Vec): Vec => {
    const d = sub(e.b, e.a);
    const l2 = dot(d, d) || 1;
    const t = Math.max(0, Math.min(1, dot(sub(wp, e.a), d) / l2));
    return add(e.a, v(d.x * t, d.y * t));
  };

  const style = (over: Partial<Style> = {}): Style => {
    const o = live.current.opts;
    return defaultStyle({ color: o.color, width: o.width, dash: o.dash, fill: o.fill ? fillFor(o.color) : null, ...over });
  };

  const addObjs = (objs: NewObj[], key = '', extra: Partial<{ nextLabel: number }> = {}) => {
    const withIds = objs.map((o) => ({ ...o, id: uid() }) as Obj);
    store.update((p) => ({ ...p, ...extra, objects: [...p.objects, ...withIds] }), key);
    return withIds;
  };

  const schedule = () => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => { raf.current = 0; paint(); });
  };

  // ------------------------------------------------------------------ painting
  const paint = () => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    const { w, h, dpr } = size.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pg = store.page;
    const L = live.current;
    const { th, xf: X } = renderPage(ctx, pg, w, h, { selected: L.selection, selectedInstrument: L.selInst, anim: anim.current });
    overlay(ctx, th, X);
    if (laser.current.length || Object.keys(anim.current).length) schedule();
  };

  const pill = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number) => {
    ctx.save();
    ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
    const w = ctx.measureText(text).width + 12;
    ctx.fillStyle = 'rgba(20,40,75,0.92)';
    ctx.beginPath(); ctx.roundRect(x - w / 2, y - 22, w, 20, 6); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y - 12);
    ctx.restore();
  };

  const overlay = (ctx: CanvasRenderingContext2D, th: (typeof THEMES)['white'], X: Xf) => {
    const L = live.current;
    const d = drag.current;
    const S = (q: Vec) => v(X.tx(q.x), X.ty(q.y));
    const preview = (o: NewObj) => drawObj(ctx, { ...o, id: 'preview', style: { ...o.style, opacity: 0.75 } } as Obj, X, th, false);
    const ghostStyle = style();

    if (d?.k === 'stroke') {
      if (d.edge) preview({ t: 'line', a: d.pts[0], b: d.pts[d.pts.length - 1], ext: 'none', arrow: 'none', style: ghostStyle });
      else preview({ t: 'stroke', pts: d.pts, style: d.hl ? defaultStyle({ color: L.opts.color, width: L.opts.width * 6 + 8, opacity: 0.35 }) : ghostStyle });
    } else if (d?.k === 'shape') {
      const t = L.tool;
      if (t === 'line' || t === 'arrow') {
        preview({ t: 'line', a: d.a, b: d.b, ext: 'none', arrow: t === 'arrow' ? 'end' : 'none', style: ghostStyle });
        const len = dist(d.a, d.b);
        const m = S(v((d.a.x + d.b.x) / 2, (d.a.y + d.b.y) / 2));
        pill(ctx, `${formatNum(len, 0.01)}  ∠ ${formatNum(deg(angleOf(sub(d.b, d.a))), 0.1)}°`, m.x, m.y - 10);
      } else if (t === 'circle') {
        const r = dist(d.a, d.b);
        preview({ t: 'circle', c: d.a, r, style: ghostStyle });
        preview({ t: 'line', a: d.a, b: d.b, ext: 'none', arrow: 'none', style: defaultStyle({ color: '#7a869a', width: 1, dash: 'dashed' }) });
        const m = S(d.b);
        pill(ctx, `r = ${formatNum(r, 0.01)}`, m.x, m.y - 8);
      } else if (t === 'rect') {
        preview({ t: 'polygon', closed: true, pts: [d.a, v(d.b.x, d.a.y), d.b, v(d.a.x, d.b.y)], style: ghostStyle });
        const m = S(d.b);
        pill(ctx, `${formatNum(Math.abs(d.b.x - d.a.x), 0.01)} × ${formatNum(Math.abs(d.b.y - d.a.y), 0.01)}`, m.x, m.y - 8);
      }
    } else if (d?.k === 'sweep') {
      const a0 = Math.min(d.a0, d.a0 + d.sweep), a1 = Math.max(d.a0, d.a0 + d.sweep);
      if (a1 - a0 > 0.01) preview({ t: 'arc', c: d.c, r: d.r, a0, a1, style: ghostStyle });
      const e = S(v(d.c.x + d.r * Math.cos(d.a0 + d.sweep), d.c.y + d.r * Math.sin(d.a0 + d.sweep)));
      preview({ t: 'line', a: d.c, b: v(d.c.x + d.r * Math.cos(d.a0 + d.sweep), d.c.y + d.r * Math.sin(d.a0 + d.sweep)), ext: 'none', arrow: 'none', style: defaultStyle({ color: '#7a869a', width: 1, dash: 'dashed' }) });
      pill(ctx, `r = ${formatNum(d.r, 0.01)}   sweep ${formatNum(Math.abs(deg(d.sweep)), 1)}°`, e.x, e.y - 8);
    }

    // pending clicks (angle / constructions / compass centre)
    const pending = [...seq.current, ...(compassCenter.current && L.tool === 'compass' ? [compassCenter.current] : [])];
    for (const q of pending) {
      const s = S(q);
      ctx.save(); ctx.strokeStyle = '#d64550'; ctx.fillStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(s.x, s.y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
    }
    if (pending.length && hover.current && (L.tool === 'angle' || L.tool.startsWith('c:'))) {
      ctx.save(); ctx.strokeStyle = 'rgba(214,69,80,0.7)'; ctx.setLineDash([5, 4]); ctx.beginPath();
      pending.forEach((q, i) => { const s = S(q); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y); });
      ctx.lineTo(hover.current.x, hover.current.y); ctx.stroke(); ctx.restore();
    }

    // trace marker
    if (L.tool === 'trace' && hover.current) {
      const pg = store.page;
      const wx = X.ix(hover.current.x);
      let best: { x: number; y: number; color: string } | null = null, bestD = 1e9;
      for (const eq of pg.equations) {
        if (!eq.visible) continue;
        const { parsed } = compileEquation(eq.text, pg.angleUnit);
        if (parsed?.kind !== 'cartesian') continue;
        const env = paramDefaults(parsed.params, pg.params);
        const lx = isLogX(pg.paper.kind), ly = isLogY(pg.paper.kind);
        env.x = lx ? Math.pow(10, wx) : wx;
        const y = parsed.f(env);
        const py = ly ? (y > 0 ? Math.log10(y) : NaN) : y;
        if (!isFinite(py)) continue;
        const dd = Math.abs(X.ty(py) - hover.current.y);
        if (dd < bestD) { bestD = dd; best = { x: env.x, y, color: eq.color }; }
      }
      if (best) {
        const sx = X.tx(isLogX(pg.paper.kind) ? Math.log10(best.x) : best.x), sy = X.ty(isLogY(pg.paper.kind) ? Math.log10(best.y) : best.y);
        ctx.save(); ctx.strokeStyle = 'rgba(120,130,150,0.8)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, size.current.h); ctx.moveTo(0, sy); ctx.lineTo(size.current.w, sy); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = best.color; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(sx, sy, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.restore();
        pill(ctx, `(${formatNum(best.x, 0.001)}, ${formatNum(best.y, 0.001)})`, sx, sy - 12);
      }
    }

    // laser trail
    const now = performance.now();
    laser.current = laser.current.filter((p) => now - p.t < 700);
    laser.current.forEach((p) => {
      const a = 1 - (now - p.t) / 700;
      ctx.fillStyle = `rgba(255,40,40,${a * 0.85})`;
      ctx.beginPath(); ctx.arc(p.x, p.y, 3 + 6 * a, 0, Math.PI * 2); ctx.fill();
    });

    // eraser ring: shows exactly what will be rubbed out
    if (L.tool === 'eraser' && hover.current) {
      const r = L.opts.eraserSize;
      ctx.save();
      ctx.beginPath(); ctx.arc(hover.current.x, hover.current.y, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fill();
      ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.stroke();
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(25,37,90,0.9)'; ctx.setLineDash(L.opts.eraseWhole ? [4, 3] : []); ctx.stroke();
      ctx.restore();
    }

    // spotlight
    if (L.spotlight && hover.current) {
      ctx.save(); ctx.fillStyle = 'rgba(8,16,30,0.62)'; ctx.beginPath();
      ctx.rect(0, 0, size.current.w, size.current.h);
      ctx.arc(hover.current.x, hover.current.y, 120, 0, Math.PI * 2);
      ctx.fill('evenodd'); ctx.restore();
    }
  };

  // ------------------------------------------------------------------ status line
  const setStatus = (P: Vec | null) => {
    if (!status.current) return;
    if (!P) { status.current.textContent = ''; return; }
    const pg = store.page, wp = toPlot(P);
    const lx = isLogX(pg.paper.kind), ly = isLogY(pg.paper.kind);
    const dx = lx ? Math.pow(10, wp.x) : wp.x, dy = ly ? Math.pow(10, wp.y) : wp.y;
    const stepX = niceStep(2 / pg.view.sx), stepY = niceStep(2 / pg.view.sy);
    let t = `x ${formatNum(dx, stepX / 10)}   y ${formatNum(dy, stepY / 10)}`;
    if (pg.paper.kind === 'polar') t += `   r ${formatNum(Math.hypot(wp.x, wp.y), stepX / 10)}   θ ${formatNum(deg(Math.atan2(wp.y, wp.x) + (wp.y < 0 ? 2 * Math.PI : 0)), 0.1)}°`;
    for (const i of pg.instruments) {
      const r = protractorReading(i, wp);
      if (r) { t += `   Protractor: ${formatNum(r.outer, 0.1)}° (outer) · ${formatNum(r.inner, 0.1)}° (inner)`; break; }
    }
    status.current.textContent = t;
  };

  // ------------------------------------------------------------------ zoom / pan
  const setView = (cx: number, cy: number, sx: number, sy: number) =>
    store.setView({ cx, cy, sx: Math.min(5e6, Math.max(0.0005, sx)), sy: Math.min(5e6, Math.max(0.0005, sy)) });

  const zoomAt = (P: Vec, factor: number, axis: 'both' | 'x' | 'y' = 'both') => {
    const vw = store.page.view, { w, h } = size.current;
    const wp = toPlot(P);
    const lock = live.current.opts.lockAspect;
    const fx = axis === 'y' ? 1 : factor, fy = axis === 'x' ? 1 : factor;
    const nsx = vw.sx * (lock ? factor : fx), nsy = vw.sy * (lock ? factor : fy);
    setView(wp.x - (P.x - w / 2) / nsx, wp.y + (P.y - h / 2) / nsy, nsx, nsy);
  };

  useImperativeHandle(handle, () => ({
    zoom: (f) => zoomAt(v(size.current.w / 2, size.current.h / 2), f),
    fit: () => {
      const pg = store.page, built = chartFor(pg);
      const { w, h } = size.current;
      if (built && !built.error) store.setView(fitView(built.bounds, w, h, pg.chart?.kind === 'pie'));
      else store.setView(newPage('x', pg.paper.kind).view);
    },
    animate: (id) => {
      const t0 = performance.now();
      const step = () => {
        const p = Math.min(1, (performance.now() - t0) / 3200);
        if (p >= 1) delete anim.current[id]; else { anim.current[id] = p; requestAnimationFrame(step); }
        schedule();
      };
      anim.current[id] = 0;
      step();
    },
    size: () => ({ w: size.current.w, h: size.current.h }),
  }));

  // ------------------------------------------------------------------ pointer handling
  const rel = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return v(e.clientX - r.left, e.clientY - r.top);
  };

  const commitConstruct = () => {
    const id = live.current.tool.slice(2);
    const ct = TOOL_BY_ID[id];
    if (!ct) return;
    const pts = [...seq.current];
    seq.current = [];
    const pg = store.page;
    let next = pg.nextLabel;
    const label = () => letterLabel(next++);
    const o = live.current.opts;
    const built = ct.build(pts, { n: o.sides, angleDeg: o.angleDeg, sss: o.sss, color: o.color, label });
    if (typeof built === 'string') { toast(built); schedule(); return; }
    const objs: NewObj[] = [];
    if (ct.autoPoints) {
      const existing = snapTargets(pg.objects);
      for (const p of pts) if (!existing.some((q) => dist(q, p) < 1e-9)) objs.push({ t: 'point', p, label: label(), style: defaultStyle({ color: o.color, width: 2 }) });
    }
    objs.push(...built);
    addObjs(objs, '', { nextLabel: next });
    schedule();
  };

  const onDown = (e: PointerEvent) => {
    const c = canvas.current!;
    c.setPointerCapture(e.pointerId);
    const P = rel(e);
    pointers.current.set(e.pointerId, P);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = { d0: Math.max(1, dist(a, b)), mid: v((a.x + b.x) / 2, (a.y + b.y) / 2), view: { ...store.page.view } };
      drag.current = null; // a second finger cancels the drawing in progress
      schedule();
      return;
    }
    if (pointers.current.size > 2) return;
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;

    const L = live.current;
    const pg = store.page;
    const wp = toPlot(P);
    hover.current = P;

    if (e.button === 1 || space.current || L.tool === 'pan') { drag.current = { k: 'pan', last: P }; return; }

    const X = xf();
    // 1. instruments: rotate handle, then edges for drawing, then body
    if (!e.altKey) {
      for (const inst of [...pg.instruments].reverse()) {
        if (hitHandle(inst, X, P)) {
          setSelInst(inst.id);
          drag.current = { k: 'inst-rot', id: inst.id, ang0: angleOf(sub(wp, v(inst.x, inst.y))), a0: inst.angle };
          return;
        }
      }
    }
    const edge = !e.altKey && DRAW_TOOLS.includes(L.tool) ? findEdge(P) : null;
    if (!edge && !e.altKey && BODY_DRAG_TOOLS.includes(L.tool)) {
      const inst = [...pg.instruments].reverse().find((i) => hitInstrument(i, wp));
      if (inst) { setSelInst(inst.id); drag.current = { k: 'inst-move', id: inst.id, last: wp }; return; }
    }

    switch (L.tool) {
      case 'select': {
        const hit = [...pg.objects].reverse().find((o) => !(o.style.cons && !pg.showConstruction) && hitObj(o, P, X));
        if (hit) {
          const next = e.shiftKey ? new Set(L.selection) : L.selection.has(hit.id) ? new Set(L.selection) : new Set<string>();
          if (e.shiftKey && next.has(hit.id)) next.delete(hit.id); else next.add(hit.id);
          setSelection(next);
          setSelInst(null);
          drag.current = { k: 'move', last: wp };
        } else { setSelection(new Set()); setSelInst(null); }
        break;
      }
      case 'pen': case 'highlighter': {
        const start = edge ? onEdge(edge, wp) : wp;
        drag.current = { k: 'stroke', pts: [start], edge, hl: L.tool === 'highlighter' };
        break;
      }
      case 'line': case 'arrow': case 'circle': case 'rect': {
        const a = edge ? onEdge(edge, wp) : snap(P, wp);
        drag.current = { k: 'shape', a, b: a, edge };
        break;
      }
      case 'compass': {
        const c0 = compassCenter.current;
        if (!c0) { compassCenter.current = snap(P, wp); toast('Centre set. Now press where the pencil starts and drag around the centre.'); break; }
        const fixed = parseFloat(L.opts.compassRadius);
        const start = snap(P, wp);
        const r = fixed > 0 ? fixed : dist(c0, start);
        const a0 = angleOf(sub(start, c0));
        drag.current = { k: 'sweep', c: c0, r, a0, last: a0, sweep: 0, moved: false, down: P };
        break;
      }
      case 'point': {
        const p = snap(P, wp);
        const label = letterLabel(pg.nextLabel);
        addObjs([{ t: 'point', p, label, style: defaultStyle({ color: L.opts.color, width: 2 }) }], '', { nextLabel: pg.nextLabel + 1 });
        break;
      }
      case 'text': {
        const hit = [...pg.objects].reverse().find((o) => o.t === 'text' && hitObj(o, P, X));
        if (hit && hit.t === 'text') setTextEdit({ at: hit.p, id: hit.id, value: hit.text, size: hit.size });
        else setTextEdit({ at: snap(P, wp), value: '', size: 12 + L.opts.width * 3 });
        break;
      }
      case 'angle': {
        seq.current.push(snap(P, wp)); setHintTick((n) => n + 1);
        if (seq.current.length === 3) {
          const [a, vtx, b] = seq.current;
          seq.current = [];
          if (dist(a, vtx) > 1e-9 && dist(b, vtx) > 1e-9) addObjs([{ t: 'angle', v: vtx, a, b, label: '', style: defaultStyle({ color: L.opts.color === 'auto' ? '#d64550' : L.opts.color, width: 1.8 }) }]);
        }
        break;
      }
      case 'eraser': {
        eraseKey.current = `erase:${performance.now()}`;   // one drag = one undo step
        drag.current = { k: 'erase', last: P };
        doErase(P, P);
        break;
      }
      case 'laser': {
        drag.current = { k: 'laser' };
        break;
      }
      default:
        if (L.tool.startsWith('c:')) {
          const ct = TOOL_BY_ID[L.tool.slice(2)];
          if (ct) { seq.current.push(snap(P, wp)); setHintTick((n) => n + 1); if (seq.current.length >= ct.need) commitConstruct(); }
        }
    }
    schedule();
  };

  const eraseKey = useRef('erase');
  /** Rub out along the pointer's path from `from` to `to` (screen px); gap-free even when the pointer jumps. */
  const doErase = (from: Vec, to: Vec) => {
    const L = live.current;
    const pg = store.page;
    const next = eraseAlong(pg.objects, from, to, xf(), { radius: L.opts.eraserSize, whole: L.opts.eraseWhole, showConstruction: pg.showConstruction });
    if (next) store.update((p) => ({ ...p, objects: next }), eraseKey.current);
  };

  const onMove = (e: PointerEvent) => {
    const P = rel(e);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, P);
    hover.current = P;
    setStatus(P);
    const g = gesture.current;
    if (g && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const k = dist(a, b) / g.d0;
      const mid = v((a.x + b.x) / 2, (a.y + b.y) / 2);
      const { w, h } = size.current;
      const nsx = g.view.sx * k, nsy = g.view.sy * k;
      // keep the plot point that was under the initial midpoint under the current midpoint
      const wx = g.view.cx + (g.mid.x - w / 2) / g.view.sx, wy = g.view.cy - (g.mid.y - h / 2) / g.view.sy;
      setView(wx - (mid.x - w / 2) / nsx, wy + (mid.y - h / 2) / nsy, nsx, nsy);
      return;
    }
    const d = drag.current;
    const L = live.current;
    const wp = toPlot(P);
    if (L.tool === 'laser' || L.tool === 'eraser' || L.spotlight || L.tool === 'trace' || d || seq.current.length || compassCenter.current) {
      if (L.tool === 'laser' && d?.k === 'laser') laser.current.push({ x: P.x, y: P.y, t: performance.now() });
      schedule();
    }
    if (!d) return;
    switch (d.k) {
      case 'pan': {
        const vw = store.page.view;
        setView(vw.cx - (P.x - d.last.x) / vw.sx, vw.cy + (P.y - d.last.y) / vw.sy, vw.sx, vw.sy);
        d.last = P;
        break;
      }
      case 'stroke': {
        const q = d.edge ? onEdge(d.edge, wp) : wp;
        const last = d.pts[d.pts.length - 1];
        if (dist(toScreen(last), toScreen(q)) >= 1.5) d.pts.push(q);
        break;
      }
      case 'shape': {
        let b = d.edge ? onEdge(d.edge, wp) : snap(P, wp);
        if (e.shiftKey && !d.edge && (L.tool === 'line' || L.tool === 'arrow')) {
          const ang = Math.round(angleOf(sub(b, d.a)) / (Math.PI / 12)) * (Math.PI / 12);
          const l = dist(d.a, b);
          b = v(d.a.x + l * Math.cos(ang), d.a.y + l * Math.sin(ang));
        }
        d.b = b;
        break;
      }
      case 'sweep': {
        if (!d.moved && dist(P, d.down) > 4) d.moved = true;
        const ang = angleOf(sub(wp, d.c));
        d.sweep += angleDiff(d.last, ang);
        d.last = ang;
        break;
      }
      case 'move': {
        const dx = wp.x - d.last.x, dy = wp.y - d.last.y;
        d.last = wp;
        const sel = L.selection;
        store.update((p) => ({ ...p, objects: p.objects.map((o) => (sel.has(o.id) ? translateObj(o, dx, dy) : o)) }), 'move');
        break;
      }
      case 'inst-move': {
        const dx = wp.x - d.last.x, dy = wp.y - d.last.y;
        d.last = wp;
        store.update((p) => ({ ...p, instruments: p.instruments.map((i) => (i.id === d.id ? { ...i, x: i.x + dx, y: i.y + dy } : i)) }), 'inst');
        break;
      }
      case 'inst-rot': {
        const inst = store.page.instruments.find((i) => i.id === d.id);
        if (!inst) break;
        let ang = d.a0 + angleDiff(d.ang0, angleOf(sub(wp, v(inst.x, inst.y))));
        const q = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12);
        if (Math.abs(ang - q) < (1.5 * Math.PI) / 180) ang = q; // magnetic 15° steps
        store.update((p) => ({ ...p, instruments: p.instruments.map((i) => (i.id === d.id ? { ...i, angle: ang } : i)) }), 'inst');
        break;
      }
      case 'erase': doErase(d.last, P); d.last = P; break;
      case 'laser': laser.current.push({ x: P.x, y: P.y, t: performance.now() }); break;
    }
    schedule();
  };

  const onUp = (e: PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current = null;
    const d = drag.current;
    drag.current = null;
    if (e.pointerType !== 'mouse') hover.current = null;   // no hover on touch: hide the eraser ring/spotlight after lifting
    const L = live.current;
    if (d) {
      switch (d.k) {
        case 'stroke': {
          if (d.edge) {
            const a = d.pts[0], b = d.pts[d.pts.length - 1];
            if (dist(toScreen(a), toScreen(b)) > 3) addObjs([{ t: 'line', a, b, ext: 'none', arrow: 'none', style: d.hl ? defaultStyle({ color: L.opts.color, width: L.opts.width * 6 + 8, opacity: 0.35 }) : style() }]);
          } else {
            addObjs([{ t: 'stroke', pts: d.pts, style: d.hl ? defaultStyle({ color: L.opts.color, width: L.opts.width * 6 + 8, opacity: 0.35 }) : style() }]);
          }
          break;
        }
        case 'shape': {
          const long = dist(toScreen(d.a), toScreen(d.b)) > 3;
          if (!long) break;
          if (L.tool === 'line' || L.tool === 'arrow') addObjs([{ t: 'line', a: d.a, b: d.b, ext: 'none', arrow: L.tool === 'arrow' ? 'end' : 'none', style: style() }]);
          else if (L.tool === 'circle') addObjs([{ t: 'circle', c: d.a, r: dist(d.a, d.b), style: style() }]);
          else if (L.tool === 'rect') addObjs([{ t: 'polygon', closed: true, pts: [d.a, v(d.b.x, d.a.y), d.b, v(d.a.x, d.b.y)], style: style() }]);
          break;
        }
        case 'sweep': {
          if (!d.moved) {
            compassCenter.current = snap(rel(e), toPlot(rel(e))); // a plain click picks a new centre
            toast('New centre set.');
          } else if (Math.abs(d.sweep) > 0.03) {
            if (Math.abs(d.sweep) >= Math.PI * 1.94) addObjs([{ t: 'circle', c: d.c, r: d.r, style: style() }]);
            else addObjs([{ t: 'arc', c: d.c, r: d.r, a0: Math.min(d.a0, d.a0 + d.sweep), a1: Math.max(d.a0, d.a0 + d.sweep), style: style() }]);
          }
          break;
        }
        default: break;
      }
    }
    schedule();
  };

  const onLeave = () => { hover.current = null; setStatus(null); schedule(); };

  const onDouble = (e: PointerEvent | MouseEvent) => {
    if (live.current.tool !== 'select') return;
    const P = rel(e);
    const hit = [...store.page.objects].reverse().find((o) => o.t === 'text' && hitObj(o, P, xf()));
    if (hit && hit.t === 'text') setTextEdit({ at: hit.p, id: hit.id, value: hit.text, size: hit.size });
  };

  // ------------------------------------------------------------------ effects
  useEffect(() => {
    const c = canvas.current!, wr = wrap.current!;
    const resize = () => {
      const r = wr.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      size.current = { w: Math.max(100, r.width), h: Math.max(100, r.height), dpr };
      c.width = Math.round(size.current.w * dpr);
      c.height = Math.round(size.current.h * dpr);
      c.style.width = `${size.current.w}px`;
      c.style.height = `${size.current.h}px`;
      schedule();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wr);
    resize();

    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
      zoomAt(rel(e), f, e.ctrlKey && !live.current.opts.lockAspect ? 'x' : e.altKey && !live.current.opts.lockAspect ? 'y' : 'both');
    };
    c.addEventListener('wheel', wheel, { passive: false });
    c.addEventListener('pointerdown', onDown);
    c.addEventListener('pointermove', onMove);
    c.addEventListener('pointerup', onUp);
    c.addEventListener('pointercancel', onUp);
    c.addEventListener('pointerleave', onLeave);
    c.addEventListener('dblclick', onDouble);

    const isTyping = () => { const el = document.activeElement; return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el as HTMLElement).isContentEditable); };
    const key = (e: KeyboardEvent) => {
      if (isTyping()) return;
      const mod = e.ctrlKey || e.metaKey;
      if (e.code === 'Space') { space.current = e.type === 'keydown'; if (e.type === 'keydown') e.preventDefault(); return; }
      if (e.type !== 'keydown') return;
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? store.redo() : store.undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); store.redo(); return; }
      if (e.key === 'Escape') { seq.current = []; setHintTick((n) => n + 1); compassCenter.current = null; drag.current = null; setSelection(new Set()); setTextEdit(null); schedule(); return; }
      const sel = live.current.selection;
      if ((e.key === 'Delete' || e.key === 'Backspace') && (sel.size || live.current.selInst)) {
        e.preventDefault();
        const id = live.current.selInst;
        store.update((p) => ({ ...p, objects: p.objects.filter((o) => !sel.has(o.id)), instruments: id ? p.instruments.filter((i) => i.id !== id) : p.instruments }));
        setSelection(new Set()); setSelInst(null);
      } else if (mod && e.key.toLowerCase() === 'd' && sel.size) {
        e.preventDefault();
        const { gx, gy } = gridMinor();
        const copies = store.page.objects.filter((o) => sel.has(o.id)).map((o) => ({ ...translateObj(o, gx * 2, -gy * 2), id: uid() }) as Obj);
        store.update((p) => ({ ...p, objects: [...p.objects, ...copies] }));
        setSelection(new Set(copies.map((o) => o.id)));
      } else if (e.key.startsWith('Arrow') && sel.size) {
        e.preventDefault();
        const { gx, gy } = gridMinor();
        const k = e.shiftKey ? 5 : 1;
        const dx = e.key === 'ArrowLeft' ? -gx * k : e.key === 'ArrowRight' ? gx * k : 0;
        const dy = e.key === 'ArrowUp' ? gy * k : e.key === 'ArrowDown' ? -gy * k : 0;
        store.update((p) => ({ ...p, objects: p.objects.map((o) => (sel.has(o.id) ? translateObj(o, dx, dy) : o)) }), 'nudge');
      } else if (e.key === '+' || e.key === '=') zoomAt(v(size.current.w / 2, size.current.h / 2), 1.25);
      else if (e.key === '-') zoomAt(v(size.current.w / 2, size.current.h / 2), 0.8);
    };
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', key);
    return () => {
      ro.disconnect();
      c.removeEventListener('wheel', wheel);
      c.removeEventListener('pointerdown', onDown);
      c.removeEventListener('pointermove', onMove);
      c.removeEventListener('pointerup', onUp);
      c.removeEventListener('pointercancel', onUp);
      c.removeEventListener('pointerleave', onLeave);
      c.removeEventListener('dblclick', onDouble);
      window.removeEventListener('keydown', key);
      window.removeEventListener('keyup', key);
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
    // handlers read everything through refs / the store, so they are created once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // repaint on any document / prop change, and reset half-finished gestures when the tool changes
  useEffect(() => { schedule(); });
  useEffect(() => { seq.current = []; setHintTick((n) => n + 1); compassCenter.current = null; drag.current = null; }, [tool, page.id]);

  const th = THEMES[page.paper.tone];
  const cursor = tool === 'pan' ? 'grab' : tool === 'text' ? 'text' : tool === 'select' ? 'default' : tool === 'eraser' ? 'none' : 'crosshair';
  const hint = TOOLS.find((t) => t.id === tool)?.hint ?? (tool.startsWith('c:') ? (() => { const ct = TOOL_BY_ID[tool.slice(2)]; return ct ? ct.hints[Math.min(seq.current.length, ct.hints.length - 1)] : ''; })() : '');

  const commitText = () => {
    if (!textEdit) return;
    const t = textEdit;
    setTextEdit(null);
    const value = t.value.trimEnd();
    if (t.id) {
      store.update((p) => ({ ...p, objects: value ? p.objects.map((o) => (o.id === t.id && o.t === 'text' ? { ...o, text: value } : o)) : p.objects.filter((o) => o.id !== t.id) }));
    } else if (value) addObjs([{ t: 'text', p: t.at, text: value, size: t.size, style: defaultStyle({ color: live.current.opts.color }) }]);
  };
  const tp = textEdit ? toScreen(textEdit.at) : null;

  return (
    <div className="stage" ref={wrap} style={{ background: th.bg }}>
      <canvas ref={canvas} style={{ cursor, touchAction: 'none', display: 'block' }} aria-label="Drawing canvas" role="img" />
      {textEdit && tp && (
        <textarea
          className="text-editor"
          autoFocus
          value={textEdit.value}
          placeholder="Type, Enter to place"
          style={{ left: tp.x - 4, top: tp.y - textEdit.size - 4, fontSize: textEdit.size, color: resolveColor(live.current.opts.color, th) }}
          onChange={(e) => setTextEdit({ ...textEdit, value: e.target.value })}
          onBlur={commitText}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitText(); }
            if (e.key === 'Escape') setTextEdit(null);
          }}
        />
      )}
      <div className="statusbar" aria-live="off">
        <span ref={status} className="coords" />
        <span className="hint">{hint}</span>
      </div>
    </div>
  );
}
