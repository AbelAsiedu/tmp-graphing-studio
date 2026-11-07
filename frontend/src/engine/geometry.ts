import type { Vec } from './types';

export const v = (x: number, y: number): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => v(a.x + b.x, a.y + b.y);
export const sub = (a: Vec, b: Vec): Vec => v(a.x - b.x, a.y - b.y);
export const mul = (a: Vec, k: number): Vec => v(a.x * k, a.y * k);
export const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
export const cross = (a: Vec, b: Vec) => a.x * b.y - a.y * b.x;
export const len = (a: Vec) => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
export const mid = (a: Vec, b: Vec): Vec => v((a.x + b.x) / 2, (a.y + b.y) / 2);
export const unit = (a: Vec): Vec => {
  const l = len(a);
  return l < 1e-12 ? v(0, 0) : v(a.x / l, a.y / l);
};
export const perp = (a: Vec): Vec => v(-a.y, a.x);
export const angleOf = (a: Vec) => Math.atan2(a.y, a.x);
export const polar = (c: Vec, r: number, ang: number): Vec => v(c.x + r * Math.cos(ang), c.y + r * Math.sin(ang));
export const rotate = (a: Vec, ang: number): Vec => {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return v(a.x * c - a.y * s, a.x * s + a.y * c);
};
export const TAU = Math.PI * 2;
export const deg = (r: number) => (r * 180) / Math.PI;
export const rad = (d: number) => (d * Math.PI) / 180;
export const normAngle = (a: number) => ((a % TAU) + TAU) % TAU;

/** Smallest signed difference b - a in (-PI, PI]. */
export function angleDiff(a: number, b: number) {
  let d = normAngle(b - a);
  if (d > Math.PI) d -= TAU;
  return d;
}

/** Foot of the perpendicular from p to the infinite line ab. */
export function foot(p: Vec, a: Vec, b: Vec): Vec {
  const d = sub(b, a);
  const l2 = dot(d, d);
  if (l2 < 1e-18) return a;
  return add(a, mul(d, dot(sub(p, a), d) / l2));
}

export function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const d = sub(b, a);
  const l2 = dot(d, d);
  if (l2 < 1e-18) return dist(p, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), d) / l2));
  return dist(p, add(a, mul(d, t)));
}

export function lineIntersection(a1: Vec, a2: Vec, b1: Vec, b2: Vec): Vec | null {
  const r = sub(a2, a1);
  const s = sub(b2, b1);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-12) return null;
  const t = cross(sub(b1, a1), s) / den;
  return add(a1, mul(r, t));
}

export function circleCircle(c1: Vec, r1: number, c2: Vec, r2: number): Vec[] {
  const d = dist(c1, c2);
  if (d < 1e-12 || d > r1 + r2 || d < Math.abs(r1 - r2)) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const m = add(c1, mul(sub(c2, c1), a / d));
  const n = mul(perp(unit(sub(c2, c1))), h);
  return h < 1e-12 ? [m] : [add(m, n), sub(m, n)];
}

export function circumcenter(a: Vec, b: Vec, c: Vec): Vec | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  return v(
    (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d,
    (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d
  );
}

export function incircle(a: Vec, b: Vec, c: Vec): { center: Vec; r: number } | null {
  const la = dist(b, c);
  const lb = dist(a, c);
  const lc = dist(a, b);
  const p = la + lb + lc;
  if (p < 1e-12) return null;
  const center = v((la * a.x + lb * b.x + lc * c.x) / p, (la * a.y + lb * b.y + lc * c.y) / p);
  const r = distToLine(center, a, b);
  return r < 1e-9 ? null : { center, r };
}

export function distToLine(p: Vec, a: Vec, b: Vec): number {
  return dist(p, foot(p, a, b));
}

/** Third vertex of a triangle with sides a = BC, b = CA, c = AB, given A at the origin and B on the +x axis. */
export function triangleSSS(a: number, b: number, c: number): { A: Vec; B: Vec; C: Vec } | null {
  if (!(a > 0 && b > 0 && c > 0)) return null;
  if (a + b <= c || a + c <= b || b + c <= a) return null;
  const cx = (b * b + c * c - a * a) / (2 * c);
  const cy2 = b * b - cx * cx;
  if (cy2 <= 0) return null;
  return { A: v(0, 0), B: v(c, 0), C: v(cx, Math.sqrt(cy2)) };
}

/** Interior angle (radians) at vertex o between rays o->a and o->b. */
export function interiorAngle(o: Vec, a: Vec, b: Vec): number {
  const u = unit(sub(a, o));
  const w = unit(sub(b, o));
  return Math.acos(Math.max(-1, Math.min(1, dot(u, w))));
}

export function pointInPolygon(p: Vec, poly: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** 1-2-5 "nice" step at least as large as `target`. */
export function niceStep(target: number): number {
  if (!(target > 0) || !isFinite(target)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(target)));
  const f = target / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

export function formatNum(n: number, step = 0): string {
  if (!isFinite(n)) return '';
  if (Math.abs(n) < 1e-12) return '0';
  const a = Math.abs(n);
  if (a >= 1e6 || a < 1e-4) return n.toExponential(1).replace('e+', '×10^').replace('e-', '×10^-');
  const dec = step > 0 ? Math.max(0, Math.min(8, -Math.floor(Math.log10(step) + 1e-9))) : 4;
  return String(Number(n.toFixed(dec)));
}

export const letterLabel = (i: number) => {
  const letter = String.fromCharCode(65 + (i % 26));
  const n = Math.floor(i / 26);
  return n ? `${letter}${n}` : letter;
};
