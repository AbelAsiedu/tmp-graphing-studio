import { describe, expect, it } from 'vitest';
import { cutPolyline, eraseAlong, eraseAt, keptIntervals, type EraseOpts } from './erase';
import { makeXf } from './render';
import { defaultStyle, type Obj, type Vec } from './types';

// 20 px per unit, 400x300 canvas, origin at the centre
const xf = makeXf({ cx: 0, cy: 0, sx: 20, sy: 20 }, 400, 300);
const scr = (x: number, y: number): Vec => ({ x: xf.tx(x), y: xf.ty(y) });
const part: EraseOpts = { radius: 10, whole: false, showConstruction: true };
const st = defaultStyle();
const stroke = (pts: Vec[], id = 's'): Obj => ({ t: 'stroke', id, pts, style: st });
const line = (a: Vec, b: Vec, extra: Partial<Extract<Obj, { t: 'line' }>> = {}): Obj => ({ t: 'line', id: 'l', a, b, ext: 'none', arrow: 'none', style: st, ...extra });
const row = (n: number) => Array.from({ length: n + 1 }, (_, i) => ({ x: i, y: 0 }));

describe('keptIntervals', () => {
  it('keeps everything when the circle misses, nothing when the segment is inside', () => {
    expect(keptIntervals({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 50 }, 5)).toEqual([[0, 1]]);
    expect(keptIntervals({ x: 4, y: 0 }, { x: 6, y: 0 }, { x: 5, y: 0 }, 5)).toEqual([]);
  });
  it('cuts a clean gap through the middle', () => {
    const k = keptIntervals({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }, 2);
    expect(k).toHaveLength(2);
    expect(k[0][1]).toBeCloseTo(0.3); expect(k[1][0]).toBeCloseTo(0.7);
  });
});

describe('eraser — freehand strokes', () => {
  it('splits a stroke in two with the cut at the circle edge', () => {
    const out = eraseAt([stroke(row(10))], scr(5, 0), xf, part)!;
    expect(out).toHaveLength(2);
    const [a, b] = out as Extract<Obj, { t: 'stroke' }>[];
    expect(a.pts[a.pts.length - 1].x).toBeCloseTo(4.5, 3);   // 10px / 20 = 0.5 units
    expect(b.pts[0].x).toBeCloseTo(5.5, 3);
    expect(a.pts[0]).toEqual({ x: 0, y: 0 });                // untouched parts keep their exact points
    expect(a.style).toEqual(st);
  });
  it('returns null when nothing is under the eraser', () => {
    expect(eraseAt([stroke(row(10))], scr(5, 5), xf, part)).toBeNull();
  });
  it('removes a stroke that is entirely inside the eraser', () => {
    const tiny = stroke([{ x: 0, y: 0 }, { x: 0.1, y: 0 }]);
    expect(eraseAt([tiny], scr(0, 0), xf, part)).toEqual([]);
  });
  it('erases the end of a stroke and leaves one piece', () => {
    const out = eraseAt([stroke(row(10))], scr(10, 0), xf, part)!;
    expect(out).toHaveLength(1);
    expect((out[0] as Extract<Obj, { t: 'stroke' }>).pts.at(-1)!.x).toBeCloseTo(9.5, 3);
  });
  it('leaves other drawings alone', () => {
    const other = stroke([{ x: 0, y: 5 }, { x: 10, y: 5 }], 'other');
    const out = eraseAt([other, stroke(row(10))], scr(5, 0), xf, part)!;
    expect(out[0]).toBe(other);
  });
});

describe('eraser — lines', () => {
  it('turns one line into two shorter lines', () => {
    const out = eraseAt([line({ x: 0, y: 0 }, { x: 10, y: 0 })], scr(5, 0), xf, part)! as Extract<Obj, { t: 'line' }>[];
    expect(out).toHaveLength(2);
    expect(out[0].b.x).toBeCloseTo(4.5, 3); expect(out[1].a.x).toBeCloseTo(5.5, 3);
    expect(out.every((l) => l.ext === 'none')).toBe(true);
  });
  it('keeps the arrow head only on the piece that still has the original end', () => {
    const out = eraseAt([line({ x: 0, y: 0 }, { x: 10, y: 0 }, { arrow: 'end' })], scr(5, 0), xf, part)! as Extract<Obj, { t: 'line' }>[];
    expect(out[0].arrow).toBe('none'); expect(out[1].arrow).toBe('end');
  });
  it('turns an infinite line into finite pieces', () => {
    const out = eraseAt([line({ x: 0, y: 0 }, { x: 1, y: 0 }, { ext: 'both' })], scr(3, 0), xf, part)! as Extract<Obj, { t: 'line' }>[];
    expect(out).toHaveLength(2);
    expect(out.every((l) => l.ext === 'none')).toBe(true);
  });
});

describe('eraser — circles, arcs and outlines', () => {
  const circle: Obj = { t: 'circle', id: 'c', c: { x: 0, y: 0 }, r: 3, style: st };
  it('turns a circle into an arc with a gap exactly the size of the eraser', () => {
    const out = eraseAt([circle], scr(3, 0), xf, part)! as Extract<Obj, { t: 'arc' }>[];
    expect(out).toHaveLength(1);
    const arc = out[0];
    expect(arc.t).toBe('arc');
    const sweep = arc.a1 - arc.a0;
    expect(sweep).toBeLessThan(Math.PI * 2);
    // both ends of the arc sit on the eraser's edge (10px)
    for (const th of [arc.a0, arc.a1]) {
      const p = scr(3 * Math.cos(th), 3 * Math.sin(th));
      expect(Math.hypot(p.x - scr(3, 0).x, p.y - scr(3, 0).y)).toBeCloseTo(10, 0);
    }
  });
  it('splits an arc into two when erased in the middle', () => {
    const arc: Obj = { t: 'arc', id: 'a', c: { x: 0, y: 0 }, r: 3, a0: 0, a1: Math.PI, style: st };
    const out = eraseAt([arc], scr(0, 3), xf, part)!;
    expect(out).toHaveLength(2);
  });
  it('leaves a circle alone when the eraser is in its middle (not on the line)', () => {
    expect(eraseAt([circle], scr(0, 0), xf, part)).toBeNull();
  });
  it('removes a filled shape in one piece', () => {
    const filled: Obj = { t: 'circle', id: 'f', c: { x: 0, y: 0 }, r: 3, style: { ...st, fill: '#abc' } };
    expect(eraseAt([filled], scr(0, 0), xf, part)).toEqual([]);
  });
  it('cuts a closed outline into one open piece when one corner is erased', () => {
    const sq: Obj = { t: 'polygon', id: 'p', closed: true, pts: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }], style: st };
    const out = eraseAt([sq], scr(0, 0), xf, part)! as Extract<Obj, { t: 'polygon' }>[];
    expect(out).toHaveLength(1);
    expect(out[0].closed).toBe(false);
    expect(out[0].pts.length).toBeGreaterThanOrEqual(5);
  });
});

describe('eraser — modes and rules', () => {
  it('"whole" mode removes any drawing the eraser touches', () => {
    expect(eraseAt([stroke(row(10))], scr(5, 0), xf, { ...part, whole: true })).toEqual([]);
  });
  it('removes points and text in one piece', () => {
    const pt: Obj = { t: 'point', id: 'pt', p: { x: 1, y: 1 }, label: 'A', style: st };
    expect(eraseAt([pt], scr(1, 1), xf, part)).toEqual([]);
  });
  it('cannot erase hidden construction lines', () => {
    const cons: Obj = { ...(stroke(row(10)) as Extract<Obj, { t: 'stroke' }>), style: { ...st, cons: true } };
    expect(eraseAt([cons], scr(5, 0), xf, { ...part, showConstruction: false })).toBeNull();
    expect(eraseAt([cons], scr(5, 0), xf, { ...part, showConstruction: true })).not.toBeNull();
  });
  it('a fast drag leaves no gaps in the cut', () => {
    const out = eraseAlong([stroke(row(10))], scr(2, 0), scr(8, 0), xf, part)! as Extract<Obj, { t: 'stroke' }>[];
    expect(out).toHaveLength(2);
    expect(out[0].pts.at(-1)!.x).toBeCloseTo(1.5, 3);
    expect(out[1].pts[0].x).toBeCloseTo(8.5, 3);
  });
  it('works at any zoom (the eraser is a fixed size on screen)', () => {
    const far = makeXf({ cx: 0, cy: 0, sx: 2, sy: 2 }, 400, 300);   // 2 px per unit
    const out = eraseAt([stroke(row(100))], { x: far.tx(50), y: far.ty(0) }, far, part)! as Extract<Obj, { t: 'stroke' }>[];
    expect(out[0].pts.at(-1)!.x).toBeCloseTo(45, 3);                  // 10px / 2 = 5 units
  });
});

describe('cutPolyline', () => {
  it('is null for untouched and empty input', () => {
    expect(cutPolyline([], [], false, { x: 0, y: 0 }, 5)).toBeNull();
    expect(cutPolyline([{ x: 0, y: 0 }, { x: 10, y: 0 }], [{ x: 0, y: 0 }, { x: 10, y: 0 }], false, { x: 5, y: 50 }, 5)).toBeNull();
  });
});
