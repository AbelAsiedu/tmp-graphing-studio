// Turns parsed equations into geometry in plot space (polylines / shaded rectangles / key points).

import type { AngleUnit, Equation, Vec, View } from './types';
import { parseEquation, type Env, type ParsedEq } from './mathParser';

export interface Frame {
  view: View;
  w: number;
  h: number;
  logX: boolean;
  logY: boolean;
  angle: AngleUnit;
}

export const bounds = (f: Frame) => ({
  x0: f.view.cx - f.w / (2 * f.view.sx),
  x1: f.view.cx + f.w / (2 * f.view.sx),
  y0: f.view.cy - f.h / (2 * f.view.sy),
  y1: f.view.cy + f.h / (2 * f.view.sy),
});

const toData = (p: number, log: boolean) => (log ? Math.pow(10, p) : p);
const toPlot = (d: number, log: boolean) => (log ? (d > 0 ? Math.log10(d) : NaN) : d);
const num = (s: string): number | null => {
  if (!s.trim()) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

export interface PlotResult {
  lines: Vec[][];
  /** flat [x0,y0,x1,y1,...] rectangles to fill (inequalities) */
  fills: number[];
  dashedBoundary: boolean;
  error?: string;
}

export interface Compiled {
  parsed: ParsedEq | null;
  error?: string;
}

const cache = new Map<string, Compiled>();
export function compileEquation(text: string, angle: AngleUnit): Compiled {
  const key = angle + '|' + text;
  let c = cache.get(key);
  if (!c) {
    try {
      c = { parsed: parseEquation(text, angle) };
    } catch (e) {
      c = { parsed: null, error: (e as Error).message };
    }
    if (cache.size > 500) cache.clear();
    cache.set(key, c);
  }
  return c;
}

export function equationParams(eqs: Equation[], angle: AngleUnit): string[] {
  const s = new Set<string>();
  for (const e of eqs) compileEquation(e.text, angle).parsed?.params.forEach((p) => s.add(p));
  return [...s].sort();
}

export function plotEquation(eq: Equation, params: Record<string, number>, f: Frame, progress = 1): PlotResult {
  const out: PlotResult = { lines: [], fills: [], dashedBoundary: false };
  const { parsed, error } = compileEquation(eq.text, f.angle);
  if (!parsed) return { ...out, error };
  const env: Env = { ...paramDefaults(parsed.params, params) };
  const b = bounds(f);
  const dMin = num(eq.dMin);
  const dMax = num(eq.dMax);
  const unitToRad = f.angle === 'deg' ? Math.PI / 180 : 1;

  const sampleCurve = (n: number, tAt: (i: number) => number, pt: (t: number) => Vec | null, jump: number) => {
    let cur: Vec[] = [];
    let last: Vec | null = null;
    const limit = Math.max(2, Math.floor(n * progress));
    for (let i = 0; i <= limit; i++) {
      const p = pt(tAt(i));
      if (!p || !isFinite(p.x) || !isFinite(p.y)) {
        if (cur.length > 1) out.lines.push(cur);
        cur = []; last = null; continue;
      }
      if (last && Math.hypot(p.x - last.x, p.y - last.y) > jump) {
        if (cur.length > 1) out.lines.push(cur);
        cur = [];
      }
      cur.push(p);
      last = p;
    }
    if (cur.length > 1) out.lines.push(cur);
  };

  switch (parsed.kind) {
    case 'cartesian': {
      const lo = dMin != null ? (f.logX ? Math.log10(Math.max(dMin, 1e-12)) : dMin) : b.x0;
      const hi = dMax != null ? (f.logX ? Math.log10(Math.max(dMax, 1e-12)) : dMax) : b.x1;
      if (!(hi > lo)) return out;
      const n = Math.min(4000, Math.ceil((f.w * (hi - lo)) / (b.x1 - b.x0) / 1.5) + 2);
      const jump = Math.max(b.y1 - b.y0, 1e-9) * 3 + (b.x1 - b.x0);
      sampleCurve(n, (i) => lo + ((hi - lo) * i) / n, (px) => {
        env.x = toData(px, f.logX);
        const y = toPlot(parsed.f(env), f.logY);
        return Number.isNaN(y) ? null : { x: px, y };
      }, jump);
      break;
    }
    case 'inverse': {
      const lo = dMin ?? b.y0;
      const hi = dMax ?? b.y1;
      if (!(hi > lo)) return out;
      const n = Math.min(4000, Math.ceil(f.h / 1.5) + 2);
      sampleCurve(n, (i) => lo + ((hi - lo) * i) / n, (py) => {
        env.y = toData(py, f.logY);
        const x = toPlot(parsed.f(env), f.logX);
        return Number.isNaN(x) ? null : { x, y: py };
      }, (b.x1 - b.x0) * 3 + (b.y1 - b.y0));
      break;
    }
    case 'polar': {
      const lo = dMin ?? 0;
      const hi = dMax ?? (f.angle === 'deg' ? 360 : Math.PI * 2);
      sampleCurve(2400, (i) => lo + ((hi - lo) * i) / 2400, (t) => {
        env.theta = t;
        const r = parsed.f(env);
        const a = t * unitToRad;
        return { x: r * Math.cos(a), y: r * Math.sin(a) };
      }, Infinity);
      break;
    }
    case 'parametric': {
      const trig = /sin|cos|tan/i.test(eq.text);
      const lo = dMin ?? (trig ? 0 : -10);
      const hi = dMax ?? (trig ? (f.angle === 'deg' ? 360 : Math.PI * 2) : 10);
      sampleCurve(2400, (i) => lo + ((hi - lo) * i) / 2400, (t) => {
        env.t = t;
        return { x: toPlot(parsed.fx(env), f.logX), y: toPlot(parsed.fy(env), f.logY) };
      }, Infinity);
      break;
    }
    case 'implicit':
      out.lines = marching(parsed.F, env, f, 4);
      break;
    case 'ineq': {
      out.lines = marching(parsed.F, env, f, 4);
      out.dashedBoundary = parsed.op === '<' || parsed.op === '>';
      const cell = 6;
      const nx = Math.ceil(f.w / cell);
      const ny = Math.ceil(f.h / cell);
      const dx = (b.x1 - b.x0) / nx;
      const dy = (b.y1 - b.y0) / ny;
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const x = b.x0 + (i + 0.5) * dx;
          const y = b.y0 + (j + 0.5) * dy;
          env.x = toData(x, f.logX);
          env.y = toData(y, f.logY);
          const v = parsed.F(env);
          const ok = parsed.op === '<' || parsed.op === '<=' ? v < 0 || (parsed.op === '<=' && v === 0) : v > 0 || (parsed.op === '>=' && v === 0);
          if (ok) out.fills.push(b.x0 + i * dx, b.y0 + j * dy, b.x0 + (i + 1) * dx, b.y0 + (j + 1) * dy);
        }
      }
      break;
    }
  }
  return out;
}

export function paramDefaults(names: string[], values: Record<string, number>): Env {
  const env: Env = {};
  for (const n of names) env[n] = values[n] ?? 1;
  return env;
}

/** Marching squares: zero set of F(x, y) over the visible area. */
function marching(F: (e: Env) => number, base: Env, f: Frame, cell: number): Vec[][] {
  const b = bounds(f);
  const nx = Math.ceil(f.w / cell);
  const ny = Math.ceil(f.h / cell);
  const dx = (b.x1 - b.x0) / nx;
  const dy = (b.y1 - b.y0) / ny;
  const env: Env = { ...base };
  const vals = new Float64Array((nx + 1) * (ny + 1));
  for (let j = 0; j <= ny; j++) {
    for (let i = 0; i <= nx; i++) {
      env.x = toData(b.x0 + i * dx, f.logX);
      env.y = toData(b.y0 + j * dy, f.logY);
      vals[j * (nx + 1) + i] = F(env);
    }
  }
  const segs: Vec[][] = [];
  const at = (i: number, j: number) => vals[j * (nx + 1) + i];
  // table of edge pairs per case; edges: 0 top (a-b), 1 right (b-c), 2 bottom (d-c), 3 left (a-d)
  const T: number[][][] = [[], [[3, 2]], [[2, 1]], [[3, 1]], [[0, 1]], [[0, 3], [2, 1]], [[0, 2]], [[3, 0]], [[0, 3]], [[0, 2]], [[0, 1], [2, 3]], [[0, 1]], [[3, 1]], [[1, 2]], [[2, 3]], []];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      // a = top-left (i, j+1), b = top-right, c = bottom-right (i+1, j), d = bottom-left
      const a = at(i, j + 1), bb = at(i + 1, j + 1), c = at(i + 1, j), d = at(i, j);
      if (!(isFinite(a) && isFinite(bb) && isFinite(c) && isFinite(d))) continue;
      const idx = (a > 0 ? 8 : 0) | (bb > 0 ? 4 : 0) | (c > 0 ? 2 : 0) | (d > 0 ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const x0 = b.x0 + i * dx, y0 = b.y0 + j * dy, x1 = x0 + dx, y1 = y0 + dy;
      const lerp = (v1: number, v2: number) => v1 / (v1 - v2);
      const edge = (e: number): Vec => {
        switch (e) {
          case 0: return { x: x0 + dx * lerp(a, bb), y: y1 };
          case 1: return { x: x1, y: y1 - dy * lerp(bb, c) };
          case 2: return { x: x0 + dx * lerp(d, c), y: y0 };
          default: return { x: x0, y: y1 - dy * lerp(a, d) };
        }
      };
      for (const [e1, e2] of T[idx]) segs.push([edge(e1), edge(e2)]);
    }
  }
  return segs;
}

// -------------------------------------------------------------------- key points

export interface KeyPoint {
  x: number;
  y: number;
  kind: 'x-intercept' | 'y-intercept' | 'maximum' | 'minimum' | 'intersection';
}

/** Roots, y-intercept, turning points of y = f(x) and intersections between cartesian equations (linear axes only). */
export function keyPoints(eqs: Equation[], params: Record<string, number>, f: Frame): Map<string, KeyPoint[]> {
  const result = new Map<string, KeyPoint[]>();
  if (f.logX || f.logY) return result;
  const b = bounds(f);
  const N = 800;
  const fns: { id: string; fn: (x: number) => number; want: boolean }[] = [];
  for (const eq of eqs) {
    if (!eq.visible) continue;
    const { parsed } = compileEquation(eq.text, f.angle);
    if (parsed?.kind !== 'cartesian') continue;
    const env = paramDefaults(parsed.params, params);
    const lo = num(eq.dMin), hi = num(eq.dMax);
    fns.push({
      id: eq.id,
      want: eq.keyPoints,
      fn: (x) => {
        if ((lo != null && x < lo) || (hi != null && x > hi)) return NaN;
        env.x = x;
        return parsed.f(env);
      },
    });
  }
  const refine = (g: (x: number) => number, a: number, c: number) => {
    let ga = g(a);
    for (let k = 0; k < 50; k++) {
      const m = (a + c) / 2;
      const gm = g(m);
      if (Math.sign(gm) === Math.sign(ga)) { a = m; ga = gm; } else c = m;
    }
    return (a + c) / 2;
  };
  const dx = (b.x1 - b.x0) / N;
  const xs = Array.from({ length: N + 1 }, (_, i) => b.x0 + i * dx);
  const tol = (b.y1 - b.y0) * 0.6;

  for (const e of fns) {
    if (!e.want) continue;
    const pts: KeyPoint[] = [];
    const ys = xs.map(e.fn);
    for (let i = 0; i < N; i++) {
      const y0 = ys[i], y1 = ys[i + 1];
      if (!isFinite(y0) || !isFinite(y1)) continue;
      if (y0 === 0) pts.push({ x: xs[i], y: 0, kind: 'x-intercept' });
      else if (y0 * y1 < 0 && Math.abs(y1 - y0) < tol) {
        const x = refine(e.fn, xs[i], xs[i + 1]);
        pts.push({ x, y: 0, kind: 'x-intercept' });
      }
      if (i > 0 && isFinite(ys[i - 1])) {
        const s0 = ys[i] - ys[i - 1], s1 = ys[i + 1] - ys[i];
        if (s0 > 0 && s1 <= 0 || s0 < 0 && s1 >= 0) {
          // refine the turning point with a ternary search around xs[i]
          const up = s0 > 0;
          let lo = xs[i - 1], hi = xs[i + 1];
          for (let k = 0; k < 60; k++) {
            const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
            if ((e.fn(m1) < e.fn(m2)) === up) lo = m1; else hi = m2;
          }
          const x = (lo + hi) / 2;
          if (!pts.some((p) => Math.abs(p.x - x) < dx)) pts.push({ x, y: e.fn(x), kind: up ? 'maximum' : 'minimum' });
        }
      }
    }
    if (b.x0 <= 0 && b.x1 >= 0) {
      const y = e.fn(0);
      if (isFinite(y)) pts.push({ x: 0, y, kind: 'y-intercept' });
    }
    result.set(e.id, dedupe(pts).slice(0, 14));
  }

  // intersections between pairs of equations where either asked for key points
  for (let i = 0; i < fns.length; i++) {
    for (let j = i + 1; j < fns.length; j++) {
      if (!fns[i].want && !fns[j].want) continue;
      const g = (x: number) => fns[i].fn(x) - fns[j].fn(x);
      const gs = xs.map(g);
      for (let k = 0; k < N; k++) {
        const a = gs[k], c = gs[k + 1];
        if (!isFinite(a) || !isFinite(c)) continue;
        let x: number | null = null;
        if (a === 0) x = xs[k];
        else if (a * c < 0 && Math.abs(c - a) < tol) x = refine(g, xs[k], xs[k + 1]);
        if (x == null) continue;
        const list = result.get(fns[i].id) ?? [];
        list.push({ x, y: fns[i].fn(x), kind: 'intersection' });
        result.set(fns[i].id, dedupe(list).slice(0, 20));
      }
    }
  }
  return result;
}

function dedupe(pts: KeyPoint[]): KeyPoint[] {
  const out: KeyPoint[] = [];
  for (const p of pts) if (!out.some((q) => Math.abs(q.x - p.x) < 1e-6 && Math.abs(q.y - p.y) < 1e-6)) out.push(p);
  return out;
}
