import { describe, expect, it } from 'vitest';
import { compileExpr, parseEquation } from './mathParser';
import { circleCircle, circumcenter, incircle, niceStep, triangleSSS, dist, v, foot, interiorAngle, deg } from './geometry';
import { buildChart, parseGroups, summarize } from './stats';
import { compileEquation, keyPoints, plotEquation, type Frame } from './plot';
import { CONSTRUCT_TOOLS } from './constructions';
import { defaultStyle, newPage, type Equation } from './types';

const ev = (src: string, env: Record<string, number> = {}, angle: 'deg' | 'rad' = 'rad') => compileExpr(src, angle).fn(env);
const close = (a: number, b: number, d = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(d);

describe('expression parser', () => {
  it('handles precedence, unary minus and right-associative powers', () => {
    expect(ev('2+3*4')).toBe(14);
    expect(ev('-x^2', { x: 3 })).toBe(-9);
    expect(ev('2^3^2')).toBe(512);
    expect(ev('2^-1')).toBe(0.5);
    expect(ev('(1+2)(3+4)')).toBe(21);
  });
  it('supports textbook implicit multiplication', () => {
    expect(ev('2x+1', { x: 4 })).toBe(9);
    expect(ev('x(x+1)', { x: 3 })).toBe(12);
    expect(ev('3sin(x)', { x: Math.PI / 2 })).toBeCloseTo(3);
    expect(ev('ax^2+bx+c', { a: 2, b: 3, c: 1, x: 2 })).toBe(15);
    expect(ev('sinx', { x: Math.PI / 2 })).toBeCloseTo(1);
    expect(ev('2pi')).toBeCloseTo(2 * Math.PI);
  });
  it('trig in degrees gives exact textbook values', () => {
    expect(ev('sin(30)', {}, 'deg')).toBeCloseTo(0.5, 12);
    expect(ev('cos(90)', {}, 'deg')).toBe(0);
    expect(ev('sin(180)', {}, 'deg')).toBe(0);
    expect(ev('tan(45)', {}, 'deg')).toBeCloseTo(1, 12);
    expect(ev('tan(90)', {}, 'deg')).toBeNaN();
    expect(ev('asin(0.5)', {}, 'deg')).toBeCloseTo(30, 10);
    expect(ev('sin^2(x)+cos^2(x)', { x: 37 }, 'deg')).toBeCloseTo(1, 12);
  });
  it('reports free parameters and rejects bad input', () => {
    expect(compileExpr('m*x+c', 'rad').vars.sort()).toEqual(['c', 'm', 'x']);
    expect(() => compileExpr('2+', 'rad')).toThrow();
    expect(() => compileExpr('2 $ 3', 'rad')).toThrow();
    expect(() => compileExpr('(1+2', 'rad')).toThrow();
  });
  it('log functions', () => {
    close(ev('log(1000)'), 3);
    close(ev('ln(e)'), 1);
    close(ev('log2(8)'), 3);
    close(ev('log10(100)'), 2);
  });
});

describe('equation kinds', () => {
  const kind = (s: string) => parseEquation(s, 'deg').kind;
  it('classifies equations', () => {
    expect(kind('y = 2x + 1')).toBe('cartesian');
    expect(kind('x^2')).toBe('cartesian');
    expect(kind('2x + 1 = y')).toBe('cartesian');
    expect(kind('x = 3')).toBe('inverse');
    expect(kind('r = 2 + 2cos(theta)')).toBe('polar');
    expect(kind('(cos(t), sin(t))')).toBe('parametric');
    expect(kind('x^2 + y^2 = 25')).toBe('implicit');
    expect(kind('y > x + 1')).toBe('ineq');
    expect(kind('y <= 2x')).toBe('ineq');
  });
  it('slider parameters', () => {
    expect(parseEquation('y = mx + c', 'deg').params).toEqual(['c', 'm']);
    expect(parseEquation('y = ax^2 + bx + c', 'deg').params).toEqual(['a', 'b', 'c']);
    expect(parseEquation('x^2 + y^2 = 25', 'deg').params).toEqual([]);
  });
  it('compileEquation never throws', () => {
    expect(compileEquation('y = ', 'deg').error).toBeTruthy();
    expect(compileEquation('???', 'deg').parsed).toBeNull();
  });
});

const eq = (text: string, over: Partial<Equation> = {}): Equation => ({ id: text, text, color: '#000', visible: true, width: 2, dMin: '', dMax: '', keyPoints: true, ...over });
const frame = (over: Partial<Frame> = {}): Frame => ({ view: { cx: 0, cy: 0, sx: 40, sy: 40 }, w: 800, h: 600, logX: false, logY: false, angle: 'deg', ...over });

describe('plotting', () => {
  it('samples a parabola correctly', () => {
    const r = plotEquation(eq('y = x^2'), {}, frame());
    expect(r.lines.length).toBe(1);
    for (const p of r.lines[0]) close(p.y, p.x * p.x, 1e-9);
  });
  it('breaks tan at asymptotes instead of joining branches', () => {
    const r = plotEquation(eq('y = tan(x)'), {}, frame({ view: { cx: 0, cy: 0, sx: 4, sy: 40 }, w: 800 }));
    expect(r.lines.length).toBe(3); // branches either side of -90° and +90°
  });
  it('respects the domain and uses slider values', () => {
    const r = plotEquation(eq('y = mx', { dMin: '0', dMax: '2' }), { m: 3 }, frame());
    const xs = r.lines[0].map((p) => p.x);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(2 + 1e-9);
    const last = r.lines[0][r.lines[0].length - 1];
    close(last.y, 3 * last.x, 1e-9);
  });
  it('implicit circle: every point is on the circle', () => {
    const r = plotEquation(eq('x^2 + y^2 = 25'), {}, frame());
    expect(r.lines.length).toBeGreaterThan(100);
    for (const seg of r.lines) for (const p of seg) expect(Math.abs(Math.hypot(p.x, p.y) - 5)).toBeLessThan(0.08);
  });
  it('polar rose stays within its radius (degrees)', () => {
    const r = plotEquation(eq('r = 3cos(2theta)'), {}, frame());
    const maxR = Math.max(...r.lines.flat().map((p) => Math.hypot(p.x, p.y)));
    expect(maxR).toBeLessThanOrEqual(3.0001);
    expect(maxR).toBeGreaterThan(2.9);
  });
  it('parametric unit circle', () => {
    const r = plotEquation(eq('(cos(t), sin(t))'), {}, frame());
    for (const p of r.lines[0]) close(Math.hypot(p.x, p.y), 1, 1e-9);
  });
  it('inequality produces shaded cells only on the correct side', () => {
    const r = plotEquation(eq('y > x'), {}, frame());
    expect(r.fills.length).toBeGreaterThan(0);
    for (let i = 0; i < r.fills.length; i += 4) {
      const cx = (r.fills[i] + r.fills[i + 2]) / 2, cy = (r.fills[i + 1] + r.fills[i + 3]) / 2;
      expect(cy).toBeGreaterThan(cx);
    }
    expect(r.dashedBoundary).toBe(true);
  });
  it('log axes: y = 10^x is a straight line on semi-log paper', () => {
    const r = plotEquation(eq('y = 10^x'), {}, frame({ logY: true, view: { cx: 0, cy: 1, sx: 40, sy: 40 } }));
    for (const p of r.lines[0]) close(p.y, p.x, 1e-9);
  });
  it('key points: roots, vertex, y-intercept, intersections', () => {
    const kp = keyPoints([eq('y = x^2 - 4x + 3')], {}, frame());
    const pts = kp.get('y = x^2 - 4x + 3')!;
    const roots = pts.filter((p) => p.kind === 'x-intercept').map((p) => p.x).sort();
    close(roots[0], 1, 1e-6); close(roots[1], 3, 1e-6);
    const min = pts.find((p) => p.kind === 'minimum')!;
    close(min.x, 2, 1e-3); close(min.y, -1, 1e-3);
    close(pts.find((p) => p.kind === 'y-intercept')!.y, 3, 1e-9);

    const two = keyPoints([eq('y = x'), eq('y = 6 - x', { keyPoints: false })], {}, frame());
    const hit = two.get('y = x')!.find((p) => p.kind === 'intersection')!;
    close(hit.x, 3, 1e-6); close(hit.y, 3, 1e-6);
  });
});

describe('geometry', () => {
  it('triangle from three sides', () => {
    const t = triangleSSS(3, 4, 5)!; // a=BC=3, b=CA=4, c=AB=5
    close(dist(t.A, t.B), 5); close(dist(t.B, t.C), 3); close(dist(t.C, t.A), 4);
    expect(triangleSSS(1, 2, 5)).toBeNull();
  });
  it('circles, circumcentre, incircle', () => {
    expect(circleCircle(v(0, 0), 5, v(6, 0), 5).length).toBe(2);
    expect(circleCircle(v(0, 0), 1, v(5, 0), 1)).toEqual([]);
    const o = circumcenter(v(0, 0), v(4, 0), v(0, 3))!;
    close(o.x, 2); close(o.y, 1.5);
    const ic = incircle(v(0, 0), v(4, 0), v(0, 3))!;
    close(ic.r, 1); close(ic.center.x, 1); close(ic.center.y, 1);
  });
  it('foot of perpendicular, angles, nice steps', () => {
    const f = foot(v(3, 4), v(0, 0), v(10, 0));
    close(f.x, 3); close(f.y, 0);
    close(deg(interiorAngle(v(0, 0), v(1, 0), v(0, 1))), 90);
    expect([niceStep(0.7), niceStep(1.2), niceStep(3), niceStep(7)]).toEqual([1, 2, 5, 10]);
  });
});

describe('constructions', () => {
  const ctx = { n: 5, angleDeg: 60, sss: [3, 4, 5] as [number, number, number], color: 'auto', label: (() => { let i = 0; return () => String.fromCharCode(65 + i++); })() };
  const tool = (id: string) => CONSTRUCT_TOOLS.find((t) => t.id === id)!;

  it('perpendicular bisector passes through the midpoint at 90°', () => {
    const objs = tool('perpbisector').build([v(0, 0), v(6, 0)], ctx);
    expect(Array.isArray(objs)).toBe(true);
    const bis = (objs as any[]).find((o) => o.t === 'line' && o.ext === 'both');
    close(bis.a.x, 3, 1e-9); close(bis.b.x, 3, 1e-9);
  });
  it('angle bisector splits the angle', () => {
    const objs = tool('anglebisector').build([v(5, 0), v(0, 0), v(0, 5)], ctx) as any[];
    const ray = objs.find((o) => o.t === 'line' && o.style.color === '#d64550');
    close(deg(Math.atan2(ray.b.y - ray.a.y, ray.b.x - ray.a.x)), 45, 1e-6);
  });
  it('perpendicular from a point lands on the foot', () => {
    const objs = tool('perpfrom').build([v(0, 0), v(10, 0), v(4, 5)], ctx) as any[];
    const foot = objs.find((o) => o.t === 'point');
    close(foot.p.x, 4); close(foot.p.y, 0);
  });
  it('triangle from three sides has correct side lengths, and bad sides explain themselves', () => {
    const objs = tool('sss').build([v(1, 1)], ctx) as any[];
    const poly = objs.find((o) => o.t === 'polygon');
    close(dist(poly.pts[0], poly.pts[1]), 5); close(dist(poly.pts[1], poly.pts[2]), 3); close(dist(poly.pts[2], poly.pts[0]), 4);
    expect(typeof tool('sss').build([v(0, 0)], { ...ctx, sss: [1, 1, 9] })).toBe('string');
  });
  it('regular polygon has n equal sides', () => {
    const objs = tool('polygon').build([v(0, 0), v(3, 0)], ctx) as any[];
    const poly = objs.find((o) => o.t === 'polygon');
    expect(poly.pts.length).toBe(5);
    const s = dist(poly.pts[0], poly.pts[1]);
    for (let i = 1; i < 5; i++) close(dist(poly.pts[i], poly.pts[(i + 1) % 5]), s, 1e-9);
  });
  it('collinear / degenerate input gives a message, not an exception', () => {
    expect(typeof tool('circumcircle').build([v(0, 0), v(1, 1), v(2, 2)], ctx)).toBe('string');
    expect(typeof tool('perpfrom').build([v(0, 0), v(5, 0), v(2, 0)], ctx)).toBe('string');
  });
});

describe('statistics', () => {
  it('summary statistics (median-of-halves quartiles)', () => {
    const s = summarize([2, 4, 4, 5, 7, 9, 10])!;
    expect(s.mean).toBeCloseTo(41 / 7);
    expect(s.median).toBe(5);
    expect(s.modes).toEqual([4]);
    expect(s.q1).toBe(4); expect(s.q3).toBe(9);
    expect(s.range).toBe(8);
  });
  it('parses grouped data', () => {
    expect(parseGroups('0-10, 4\n10-20, 6')).toEqual([{ lo: 0, hi: 10, f: 4 }, { lo: 10, hi: 20, f: 6 }]);
    expect(parseGroups('12 15 15')).toBeNull();
  });
  const cfg = (kind: any, data: string, over = {}) => ({ kind, title: '', xLabel: '', yLabel: '', data, binWidth: 0, ...over });
  it('pie angles add up to 360', () => {
    const b = buildChart(cfg('pie', 'Football, 12\nNetball, 8\nAthletics, 4\nChess, 6'));
    const sectors = b.items.filter((i) => i.k === 'sector') as any[];
    const total = sectors.reduce((a, s) => a + (s.a1 - s.a0), 0);
    close(total, Math.PI * 2, 1e-9);
    expect(b.table![1][2]).toBe('144°');
  });
  it('histogram from raw data counts every value once', () => {
    const raw = '12 15 15 18 21 22 25 25 25 28 30 31 35 38 40';
    const b = buildChart(cfg('histogram', raw, { binWidth: 10 }));
    const total = (b.table!.slice(1) as string[][]).reduce((a, r) => a + Number(r[1]), 0);
    expect(total).toBe(15);
  });
  it('ogive reports median estimate from grouped data', () => {
    const b = buildChart(cfg('ogive', '0-10, 5\n10-20, 15\n20-30, 20\n30-40, 10'));
    const med = b.table!.find((r) => r[0] === 'Median')!;
    expect(Number(med[1])).toBeCloseTo(22.5, 1);
  });
  it('scatter fits the least-squares line', () => {
    const b = buildChart(cfg('scatter', '1,3\n2,5\n3,7\n4,9'));
    const row = b.table!.find((r) => r[0] === 'Line of best fit')!;
    expect(row[1]).toBe('y = 2x + 1');
  });
  it('bad data yields an explanatory error, not an exception', () => {
    expect(buildChart(cfg('bar', 'nonsense')).error).toBeTruthy();
    expect(buildChart(cfg('box', '1 2')).error).toBeTruthy();
  });
});

describe('page defaults', () => {
  it('log paper starts framed on 1..10', () => {
    expect(newPage('x', 'loglog').view.cx).toBe(1);
    expect(defaultStyle().color).toBe('auto');
  });
});
