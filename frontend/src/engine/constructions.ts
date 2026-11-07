// Ruler-and-compass constructions. Each builder returns the objects to add: the finished figure
// in solid ink and the compass arcs / helper lines as "construction" objects that can be hidden.

import {
  add, angleDiff, angleOf, circleCircle, circumcenter, deg, dist, foot, incircle, interiorAngle, mid,
  mul, perp, polar, rad, sub, triangleSSS, unit, TAU,
} from './geometry';
import { defaultStyle, type NewObj, type Style, type Vec } from './types';

export interface BuildCtx {
  n: number; // polygon sides
  angleDeg: number; // angle to draw
  sss: [number, number, number]; // triangle side lengths a, b, c
  color: string;
  label: () => string; // next free point label
}

export interface ConstructTool {
  id: string;
  label: string;
  /** How many clicks are needed; `hints[i]` is shown before click i+1. */
  need: number;
  hints: string[];
  /** If true the tool adds labelled points for the clicked positions. */
  autoPoints: boolean;
  build: (pts: Vec[], c: BuildCtx) => NewObj[] | string;
  info?: string;
}

const consStyle = (color: string): Style => defaultStyle({ color, width: 1.1, dash: 'dashed', opacity: 0.8, cons: true });
const mainStyle = (color: string, width = 2.2): Style => defaultStyle({ color, width });

const line = (a: Vec, b: Vec, style: Style, ext: 'none' | 'both' | 'ray' = 'none'): NewObj => ({ t: 'line', a, b, ext, arrow: 'none', style });
const arcThrough = (c: Vec, r: number, from: number, to: number, style: Style, pad = 0.18): NewObj => {
  // arc from angle `from` to `to` taking the short way, padded either side
  const d = angleDiff(from, to);
  const a0 = d >= 0 ? from - pad : to - pad;
  const sweep = Math.abs(d) + 2 * pad;
  return { t: 'arc', c, r, a0, a1: a0 + sweep, style };
};
/** A short arc centred on direction `at`, used to show the crossing point of two compass arcs. */
const arcAt = (c: Vec, r: number, at: number, style: Style, half = 0.28): NewObj => ({ t: 'arc', c, r, a0: at - half, a1: at + half, style });
const dot = (p: Vec, label: string, color: string): NewObj => ({ t: 'point', p, label, style: defaultStyle({ color, width: 2 }) });
const rightMark = (at: Vec, d1: Vec, d2: Vec, size: number, style: Style): NewObj => ({
  t: 'polygon', closed: false, style,
  pts: [add(at, mul(d1, size)), add(add(at, mul(d1, size)), mul(d2, size)), add(at, mul(d2, size))],
});

export const CONSTRUCT_TOOLS: ConstructTool[] = [
  {
    id: 'midpoint', label: 'Midpoint', need: 2, autoPoints: true,
    hints: ['Click the first end of the segment', 'Click the other end'],
    build: ([a, b], c) => [line(a, b, mainStyle(c.color)), dot(mid(a, b), 'M', c.color)],
  },
  {
    id: 'perpbisector', label: 'Perpendicular bisector', need: 2, autoPoints: true,
    hints: ['Click point A', 'Click point B'],
    info: 'Compass arcs of equal radius from A and B cross above and below the segment.',
    build: ([a, b], c) => {
      const d = dist(a, b);
      if (d < 1e-9) return 'Choose two different points.';
      const r = d * 0.7;
      const [p, q] = circleCircle(a, r, b, r);
      const cs = consStyle(c.color);
      return [
        line(a, b, mainStyle(c.color)),
        arcThrough(a, r, angleOf(sub(p, a)), angleOf(sub(q, a)), cs),
        arcThrough(b, r, angleOf(sub(p, b)), angleOf(sub(q, b)), cs),
        line(p, q, mainStyle(c.color), 'both'),
        dot(mid(a, b), 'M', c.color),
        rightMark(mid(a, b), unit(sub(b, a)), unit(sub(p, q)), d * 0.04, mainStyle(c.color, 1.4)),
      ];
    },
  },
  {
    id: 'anglebisector', label: 'Angle bisector', need: 3, autoPoints: true,
    hints: ['Click a point on the first arm', 'Click the vertex', 'Click a point on the second arm'],
    info: 'An arc from the vertex cuts both arms; arcs from those two points meet on the bisector.',
    build: ([a, o, b], c) => {
      const ua = unit(sub(a, o)), ub = unit(sub(b, o));
      const r1 = Math.min(dist(o, a), dist(o, b)) * 0.55;
      if (r1 < 1e-9) return 'The vertex must be different from the arm points.';
      const p = add(o, mul(ua, r1)), q = add(o, mul(ub, r1));
      const r2 = Math.max(dist(p, q) * 0.75, r1 * 0.4);
      const pts = circleCircle(p, r2, q, r2);
      if (!pts.length) return 'The arms are collinear — there is no angle to bisect.';
      const x = pts.sort((u, w) => dist(w, o) - dist(u, o))[0];
      const cs = consStyle(c.color);
      return [
        line(o, a, mainStyle(c.color), 'ray'), line(o, b, mainStyle(c.color), 'ray'),
        arcThrough(o, r1, angleOf(ua), angleOf(ub), cs, 0.12),
        arcAt(p, r2, angleOf(sub(x, p)), cs),
        arcAt(q, r2, angleOf(sub(x, q)), cs),
        line(o, x, defaultStyle({ color: '#d64550', width: 2.2 }), 'ray'),
        { t: 'angle', v: o, a: a, b: x, label: '', style: defaultStyle({ color: c.color, width: 1.3 }) },
        { t: 'angle', v: o, a: x, b: b, label: '', style: defaultStyle({ color: c.color, width: 1.3 }) },
      ];
    },
  },
  {
    id: 'perpfrom', label: 'Perpendicular from a point', need: 3, autoPoints: true,
    hints: ['Click a point on the line', 'Click a second point on the line', 'Click the point to drop the perpendicular from'],
    info: 'An arc from P cuts the line twice; arcs from those cuts meet on the other side of the line.',
    build: ([a, b, p], c) => {
      const f = foot(p, a, b);
      const d = dist(p, f);
      if (d < 1e-9) return 'The point is already on the line.';
      const u = unit(sub(b, a));
      const r1 = d * 1.45;
      const h1 = Math.sqrt(r1 * r1 - d * d);
      const s = add(f, mul(u, h1)), t = sub(f, mul(u, h1));
      const r2 = h1 * 1.2;
      const q = sub(f, mul(unit(sub(p, f)), Math.sqrt(r2 * r2 - h1 * h1)));
      const cs = consStyle(c.color);
      return [
        line(a, b, mainStyle(c.color), 'both'),
        arcThrough(p, r1, angleOf(sub(s, p)), angleOf(sub(t, p)), cs, 0.12),
        arcAt(s, r2, angleOf(sub(q, s)), cs),
        arcAt(t, r2, angleOf(sub(q, t)), cs),
        line(p, f, defaultStyle({ color: '#d64550', width: 2.2 })),
        line(f, q, defaultStyle({ color: '#d64550', width: 1.6, dash: 'dashed' })),
        dot(f, 'F', c.color),
        rightMark(f, u, unit(sub(p, f)), Math.min(d * 0.14, 0.6), mainStyle(c.color, 1.4)),
      ];
    },
  },
  {
    id: 'parallel', label: 'Parallel through a point', need: 3, autoPoints: true,
    hints: ['Click a point on the line', 'Click a second point on the line', 'Click the point the parallel must pass through'],
    info: 'Slide a set square along a ruler to draw a line parallel to the first.',
    build: ([a, b, p], c) => {
      if (dist(a, b) < 1e-9) return 'Choose two different points on the line.';
      return [line(a, b, mainStyle(c.color), 'both'), line(p, add(p, sub(b, a)), defaultStyle({ color: '#d64550', width: 2.2 }), 'both')];
    },
  },
  {
    id: 'circumcircle', label: 'Circumcircle of a triangle', need: 3, autoPoints: true,
    hints: ['Click vertex A', 'Click vertex B', 'Click vertex C'],
    info: 'The perpendicular bisectors of the sides meet at the centre of the circle through all three vertices.',
    build: ([a, b, p], c) => {
      const o = circumcenter(a, b, p);
      if (!o) return 'The three points are in a straight line.';
      const cs = consStyle(c.color);
      const bis = (x: Vec, y: Vec): NewObj => { const m = mid(x, y); return line(m, add(m, perp(sub(y, x))), cs, 'both'); };
      return [
        { t: 'polygon', pts: [a, b, p], closed: true, style: mainStyle(c.color) },
        bis(a, b), bis(b, p),
        { t: 'circle', c: o, r: dist(o, a), style: defaultStyle({ color: '#2f6fdb', width: 2.2 }) },
        dot(o, 'O', '#2f6fdb'),
      ];
    },
  },
  {
    id: 'incircle', label: 'Incircle of a triangle', need: 3, autoPoints: true,
    hints: ['Click vertex A', 'Click vertex B', 'Click vertex C'],
    info: 'The angle bisectors meet at the centre of the circle that touches all three sides.',
    build: ([a, b, p], c) => {
      const ic = incircle(a, b, p);
      if (!ic) return 'The three points are in a straight line.';
      const cs = consStyle(c.color);
      return [
        { t: 'polygon', pts: [a, b, p], closed: true, style: mainStyle(c.color) },
        line(a, ic.center, cs, 'ray'), line(b, ic.center, cs, 'ray'), line(p, ic.center, cs, 'ray'),
        { t: 'circle', c: ic.center, r: ic.r, style: defaultStyle({ color: '#1f9d6b', width: 2.2 }) },
        dot(ic.center, 'I', '#1f9d6b'),
      ];
    },
  },
  {
    id: 'polygon', label: 'Regular polygon', need: 2, autoPoints: false,
    hints: ['Click the centre', 'Click a vertex (sets size and rotation)'],
    build: ([o, p0], c) => {
      const r = dist(o, p0);
      if (r < 1e-9) return 'Drag out from the centre to set the size.';
      const n = Math.max(3, Math.min(60, Math.round(c.n)));
      const a0 = angleOf(sub(p0, o));
      const pts = Array.from({ length: n }, (_, k) => polar(o, r, a0 + (k * TAU) / n));
      return [
        { t: 'circle', c: o, r, style: consStyle(c.color) },
        { t: 'polygon', pts, closed: true, style: mainStyle(c.color) },
        dot(o, 'O', c.color),
      ];
    },
  },
  {
    id: 'angle', label: 'Draw an angle of given size', need: 2, autoPoints: true,
    hints: ['Click the vertex', 'Click along the base line'],
    info: 'Set the angle in the options, then click the vertex and a point on the base line.',
    build: ([o, p], c) => {
      const base = angleOf(sub(p, o));
      const len = dist(o, p);
      if (len < 1e-9) return 'Choose a point away from the vertex.';
      const tip = polar(o, len, base + rad(c.angleDeg));
      return [
        line(o, p, mainStyle(c.color)), line(o, tip, mainStyle(c.color)),
        { t: 'angle', v: o, a: p, b: tip, label: '', style: defaultStyle({ color: '#d64550', width: 1.6 }) },
      ];
    },
  },
  {
    id: 'sss', label: 'Triangle from 3 sides', need: 1, autoPoints: false,
    hints: ['Click where vertex A should go (the base AB lies along the paper)'],
    info: 'Set sides a, b, c in the options. Arcs of radius b from A and a from B meet at C.',
    build: ([origin], c) => {
      const [sa, sb, sc] = c.sss;
      const tri = triangleSSS(sa, sb, sc);
      if (!tri) return 'Those sides cannot make a triangle (the two shorter sides must add up to more than the longest).';
      const A = add(origin, tri.A), B = add(origin, tri.B), C = add(origin, tri.C);
      const cs = consStyle(c.color);
      const la = c.label(), lb = c.label(), lc = c.label();
      const side = (p: Vec, q: Vec, text: string): NewObj => {
        const m = mid(p, q);
        const n = unit(perp(sub(q, p)));
        return { t: 'text', p: add(m, mul(n, text.length > 3 ? 0.5 : 0.35)), text, size: 14, style: defaultStyle({ color: c.color }) };
      };
      return [
        { t: 'polygon', pts: [A, B, C], closed: true, style: mainStyle(c.color) },
        arcAt(A, sb, angleOf(sub(C, A)), cs, 0.3),
        arcAt(B, sa, angleOf(sub(C, B)), cs, 0.3),
        dot(A, la, c.color), dot(B, lb, c.color), dot(C, lc, c.color),
        side(B, C, `${sa}`), side(C, A, `${sb}`), side(A, B, `${sc}`),
      ];
    },
  },
];

export const TOOL_BY_ID = Object.fromEntries(CONSTRUCT_TOOLS.map((t) => [t.id, t]));

/** Measured size of an angle object in degrees. */
export const measureAngle = (o: { v: Vec; a: Vec; b: Vec }) => deg(interiorAngle(o.v, o.a, o.b));

/** Helper for the compass tool: normalised sweep between two angles that can exceed half a turn. */
export const sweepFrom = (start: number, current: number, prevSweep: number) => {
  let d = angleDiff(start + prevSweep, current);
  d = prevSweep + d;
  return Math.max(-TAU, Math.min(TAU, d));
};
