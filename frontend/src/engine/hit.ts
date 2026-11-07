// Hit-testing (in screen pixels) and moving of drawn objects.

import { angleOf, angleDiff, deg, distToSegment, dist, v, normAngle, pointInPolygon } from './geometry';
import type { Xf } from './instruments';
import { lineScreenEnds } from './render';
import type { Obj, Vec } from './types';

export function hitObj(o: Obj, p: Vec, xf: Xf, tol = 7): boolean {
  const S = (q: Vec) => v(xf.tx(q.x), xf.ty(q.y));
  const t = tol + o.style.width / 2;
  switch (o.t) {
    case 'stroke': {
      const pts = o.pts.map(S);
      if (pts.length === 1) return dist(pts[0], p) <= t + 2;
      for (let i = 0; i < pts.length - 1; i++) if (distToSegment(p, pts[i], pts[i + 1]) <= t) return true;
      return false;
    }
    case 'line': {
      const [A, B] = lineScreenEnds(o, xf);
      return distToSegment(p, A, B) <= t;
    }
    case 'circle': {
      const c = S(o.c);
      const rx = o.r * xf.view.sx, ry = o.r * xf.view.sy;
      const nd = Math.hypot((p.x - c.x) / rx, (p.y - c.y) / ry);
      if (o.style.fill && nd <= 1) return true;
      return Math.abs(nd - 1) * Math.min(rx, ry) <= t;
    }
    case 'arc': {
      const c = S(o.c);
      const rx = o.r * xf.view.sx, ry = o.r * xf.view.sy;
      const nd = Math.hypot((p.x - c.x) / rx, (p.y - c.y) / ry);
      if (Math.abs(nd - 1) * Math.min(rx, ry) > t) return false;
      const ang = angleOf(v((p.x - c.x) / rx, -(p.y - c.y) / ry));
      const lo = Math.min(o.a0, o.a1), sweep = Math.abs(o.a1 - o.a0);
      return normAngle(ang - lo) <= sweep;
    }
    case 'polygon': {
      const pts = o.pts.map(S);
      const n = o.closed ? pts.length : pts.length - 1;
      for (let i = 0; i < n; i++) if (distToSegment(p, pts[i], pts[(i + 1) % pts.length]) <= t) return true;
      return !!(o.closed && o.style.fill && pointInPolygon(p, pts));
    }
    case 'point': return dist(S(o.p), p) <= 11;
    case 'text': {
      const q = S(o.p);
      const lines = o.text.split('\n');
      const w = Math.max(...lines.map((l) => l.length)) * o.size * 0.56;
      return p.x >= q.x - 4 && p.x <= q.x + w + 4 && p.y >= q.y - o.size && p.y <= q.y + (lines.length - 1) * o.size * 1.25 + 6;
    }
    case 'angle': return dist(S(o.v), p) <= 40;
  }
}

export function translateObj(o: Obj, dx: number, dy: number): Obj {
  const m = (q: Vec): Vec => v(q.x + dx, q.y + dy);
  switch (o.t) {
    case 'stroke': return { ...o, pts: o.pts.map(m) };
    case 'line': return { ...o, a: m(o.a), b: m(o.b) };
    case 'circle': case 'arc': return { ...o, c: m(o.c) };
    case 'polygon': return { ...o, pts: o.pts.map(m) };
    case 'point': case 'text': return { ...o, p: m(o.p) };
    case 'angle': return { ...o, v: m(o.v), a: m(o.a), b: m(o.b) };
  }
}

/** Positions that a new line / compass point can snap to (existing points and vertices). */
export function snapTargets(objects: Obj[]): Vec[] {
  const out: Vec[] = [];
  for (const o of objects) {
    if (o.t === 'point') out.push(o.p);
    else if (o.t === 'line') out.push(o.a, o.b);
    else if (o.t === 'polygon') out.push(...o.pts);
    else if (o.t === 'circle') out.push(o.c);
  }
  return out;
}

export const describeAngle = (a: number) => `${deg(a).toFixed(1)}°`;
export { angleDiff };
