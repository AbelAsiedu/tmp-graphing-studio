// The eraser: rubs out only the part of a drawing under the eraser circle.
//
//  - freehand strokes, lines, open/closed outlines, circles and arcs are cut at the circle's edge
//    (a line becomes two shorter lines, a circle becomes an arc, a stroke splits in two …)
//  - filled shapes, points, text and angle marks cannot be partly erased, so they go in one piece
//  - "whole" mode removes any drawing the circle touches
//
// All geometry is done in screen pixels (so the eraser feels the same at every zoom level), and results
// are converted back to plot space (the space drawings are stored in).

import { dist, distToSegment, v } from './geometry';
import { hitObj } from './hit';
import type { Xf } from './instruments';
import { lineScreenEnds } from './render';
import { uid, type Obj, type Vec } from './types';

export interface EraseOpts {
  /** Eraser radius in screen pixels. */
  radius: number;
  /** Remove whole drawings instead of rubbing out part of them. */
  whole: boolean;
  /** Hidden construction lines cannot be erased. */
  showConstruction: boolean;
}

const TAU = Math.PI * 2;

/** Parts of the segment A→B (as [t0,t1] fractions) that lie OUTSIDE the circle (P, R). */
export function keptIntervals(A: Vec, B: Vec, P: Vec, R: number): Array<[number, number]> {
  const dx = B.x - A.x, dy = B.y - A.y;
  const fx = A.x - P.x, fy = A.y - P.y;
  const a = dx * dx + dy * dy;
  const c = fx * fx + fy * fy - R * R;
  if (a < 1e-12) return c <= 0 ? [] : [[0, 1]];
  const b = 2 * (fx * dx + fy * dy);
  const disc = b * b - 4 * a * c;
  if (disc <= 0) return [[0, 1]];
  const sq = Math.sqrt(disc);
  const t0 = (-b - sq) / (2 * a), t1 = (-b + sq) / (2 * a);
  if (t1 <= 0 || t0 >= 1) return [[0, 1]];
  const out: Array<[number, number]> = [];
  if (t0 > 0) out.push([0, t0]);
  if (t1 < 1) out.push([t1, 1]);
  return out;
}

interface Run { pts: Vec[]; startOrig: boolean; endOrig: boolean }

/**
 * Cut a polyline (or closed outline) with the eraser circle.
 * `sp` are the points in screen space, `pp` the same points in plot space.
 * Returns null when the eraser does not touch it; otherwise the surviving runs (possibly none).
 */
export function cutPolyline(sp: Vec[], pp: Vec[], closed: boolean, P: Vec, R: number): Run[] | null {
  const n = sp.length;
  if (n === 0) return null;
  if (n === 1) return dist(sp[0], P) <= R ? [] : null;

  const segs = closed ? n : n - 1;
  const runs: Run[] = [];
  let cur: Run | null = null;
  let touched = false;
  let startKept = false, endKept = false;

  const lerp = (a: Vec, b: Vec, t: number): Vec => v(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);

  for (let i = 0; i < segs; i++) {
    const a = i, b = (i + 1) % n;
    const kept = keptIntervals(sp[a], sp[b], P, R);
    if (!(kept.length === 1 && kept[0][0] === 0 && kept[0][1] === 1)) touched = true;
    for (const [s, e] of kept) {
      if (s === 0) {
        if (!cur) cur = { pts: [pp[a]], startOrig: i === 0, endOrig: false };
        if (i === 0) startKept = true;
      } else {
        if (cur) { runs.push(cur); cur = null; }
        cur = { pts: [lerp(pp[a], pp[b], s)], startOrig: false, endOrig: false };
      }
      if (e === 1) {
        cur!.pts.push(pp[b]);
        if (i === segs - 1) { endKept = true; cur!.endOrig = true; }
      } else {
        cur!.pts.push(lerp(pp[a], pp[b], e));
        runs.push(cur!); cur = null;
      }
    }
    // a segment that lies fully inside the eraser ends any run in progress
    if (kept.length === 0 && cur) { runs.push(cur); cur = null; }
  }
  if (cur) runs.push(cur);
  if (!touched) return null;

  // closed outline: the last run continues into the first one
  if (closed && runs.length > 1 && startKept && endKept) {
    const last = runs.pop()!, first = runs.shift()!;
    runs.unshift({ pts: last.pts.concat(first.pts.slice(1)), startOrig: false, endOrig: false });
  }
  return runs.filter((r) => r.pts.length >= 2);
}

const pxLen = (pts: Vec[], xf: Xf) => {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot((pts[i].x - pts[i - 1].x) * xf.view.sx, (pts[i].y - pts[i - 1].y) * xf.view.sy);
  return s;
};

/** Cut a circle or arc by sampling it; returns surviving angle ranges (plot-space angles), 'all' if erased entirely, or null if untouched. */
function cutArc(o: Extract<Obj, { t: 'circle' | 'arc' }>, P: Vec, R: number, xf: Xf): Array<[number, number]> | 'all' | null {
  const full = o.t === 'circle' || Math.abs(o.a1 - o.a0) >= TAU - 1e-9;
  const a0 = o.t === 'circle' ? 0 : o.a0;
  const sweep = full ? TAU : (((o.a1 - o.a0) % TAU) + TAU) % TAU;
  if (sweep < 1e-9) return null;
  const px = Math.max(Math.abs(o.r * xf.view.sx), Math.abs(o.r * xf.view.sy)) * sweep;
  const N = Math.max(90, Math.min(3000, Math.ceil(px / 1.5)));
  const th = (k: number) => a0 + (sweep * k) / N;
  const at = (t: number): Vec => v(xf.tx(o.c.x + o.r * Math.cos(t)), xf.ty(o.c.y + o.r * Math.sin(t)));
  const inside = (t: number) => dist(at(t), P) <= R;

  const ins: boolean[] = [];
  for (let k = 0; k <= N; k++) ins.push(inside(th(k)));
  if (!ins.some(Boolean)) return null;
  if (ins.every(Boolean)) return 'all';

  // bisect between a kept angle and an erased angle to find the exact cut
  const edge = (keptTh: number, erasedTh: number) => {
    let lo = keptTh, hi = erasedTh;
    for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (inside(m)) hi = m; else lo = m; }
    return lo;
  };

  const ranges: Array<[number, number]> = [];
  let start = 0;
  for (let k = 0; k <= N; k++) {
    if (ins[k]) continue;
    if (k === 0 || ins[k - 1]) start = k === 0 ? th(0) : edge(th(k), th(k - 1));
    if (k === N || ins[k + 1]) ranges.push([start, k === N ? th(N) : edge(th(k), th(k + 1))]);
  }
  // a full circle has no seam: a range ending at the seam continues into the range starting there
  if (full && ranges.length > 1 && !ins[0] && !ins[N]) {
    const last = ranges.pop()!, first = ranges.shift()!;
    ranges.unshift([last[0], first[1] + TAU]);
  }
  return ranges;
}

/** Erase at one position. Returns the new object list, or null if nothing changed. */
export function eraseAt(objects: Obj[], P: Vec, xf: Xf, opts: EraseOpts): Obj[] | null {
  const R = Math.max(1, opts.radius);
  const S = (q: Vec) => v(xf.tx(q.x), xf.ty(q.y));
  let changed = false;
  const out: Obj[] = [];

  const stroke = (o: Obj, runs: Run[]) => {
    // `o` is a stroke/line/polygon; emit one object per surviving run
    for (const r of runs) {
      if (pxLen(r.pts, xf) < 0.75) continue;
      if (o.t === 'stroke') out.push({ ...o, id: uid(), pts: r.pts });
      else if (o.t === 'polygon') out.push({ ...o, id: uid(), pts: r.pts, closed: false, style: { ...o.style, fill: null } });
      else if (o.t === 'line') {
        const arrow = o.arrow === 'none' ? 'none'
          : o.arrow === 'both' ? (r.startOrig && r.endOrig ? 'both' : r.endOrig ? 'end' : 'none')
          : r.endOrig ? 'end' : 'none';
        out.push({ ...o, id: uid(), a: r.pts[0], b: r.pts[r.pts.length - 1], ext: 'none', arrow });
      }
    }
  };

  for (const o of objects) {
    if (o.style.cons && !opts.showConstruction) { out.push(o); continue; }

    // whole-drawing mode, and shapes that cannot be partly erased
    const atomic = opts.whole || o.t === 'point' || o.t === 'text' || o.t === 'angle'
      || ((o.t === 'circle' || o.t === 'polygon') && !!o.style.fill && (o.t === 'circle' || o.closed));
    if (atomic) {
      if (hitObj(o, P, xf, opts.whole ? R : Math.min(R, 8))) { changed = true; continue; }
      out.push(o); continue;
    }

    if (o.t === 'stroke') {
      const runs = cutPolyline(o.pts.map(S), o.pts, false, P, R);
      if (!runs) { out.push(o); continue; }
      changed = true; stroke(o, runs);
    } else if (o.t === 'polygon') {
      const runs = cutPolyline(o.pts.map(S), o.pts, o.closed, P, R);
      if (!runs) { out.push(o); continue; }
      changed = true; stroke(o, runs);
    } else if (o.t === 'line') {
      // cheap reject before the exact cut
      const [A, B] = lineScreenEnds(o, xf);
      if (distToSegment(P, A, B) > R) { out.push(o); continue; }
      const pp = o.ext === 'none' ? [o.a, o.b] : [v(xf.ix(A.x), xf.iy(A.y)), v(xf.ix(B.x), xf.iy(B.y))];
      const sp = o.ext === 'none' ? [S(o.a), S(o.b)] : [A, B];
      const runs = cutPolyline(sp, pp, false, P, R);
      if (!runs) { out.push(o); continue; }
      changed = true;
      stroke(o, o.ext === 'none' ? runs : runs.map((r) => ({ ...r, startOrig: false, endOrig: false })));
    } else if (o.t === 'circle' || o.t === 'arc') {
      // cheap reject: the eraser must be within reach of the ring
      const cs = S(o.c);
      const rx = Math.abs(o.r * xf.view.sx), ry = Math.abs(o.r * xf.view.sy);
      const dc = Math.hypot(P.x - cs.x, P.y - cs.y);
      if (dc > Math.max(rx, ry) + R || dc < Math.min(rx, ry) - R) { out.push(o); continue; }
      const cut = cutArc(o, P, R, xf);
      if (cut === null) { out.push(o); continue; }
      changed = true;
      if (cut === 'all') continue;
      for (const [s, e] of cut) {
        if (e - s < 1e-6) continue;
        out.push({ t: 'arc', id: uid(), c: o.c, r: o.r, a0: s, a1: e, style: { ...o.style, fill: null } });
      }
    } else {
      out.push(o);
    }
  }
  return changed ? out : null;
}

/** Erase along a straight drag from `from` to `to`, without gaps when the pointer moves fast. */
export function eraseAlong(objects: Obj[], from: Vec, to: Vec, xf: Xf, opts: EraseOpts): Obj[] | null {
  const step = Math.max(2, opts.radius * 0.5);
  const n = Math.max(1, Math.ceil(dist(from, to) / step));
  let cur = objects, changed = false;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const next = eraseAt(cur, v(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t), xf, opts);
    if (next) { cur = next; changed = true; }
  }
  return changed ? cur : null;
}
