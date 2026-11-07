import { describe, expect, it } from 'vitest';
import { placeCard, type Rect } from './placement';
import { TOUR_STEPS } from './steps';

const vp = { w: 1400, h: 850 };
const card = { w: 340, h: 220 };
const inView = (p: { left: number; top: number }, c = card, v = vp) =>
  p.left >= 0 && p.top >= 0 && p.left + c.w <= v.w && p.top + c.h <= v.h;
const overlaps = (p: { left: number; top: number }, t: Rect) =>
  p.left < t.x + t.w && p.left + card.w > t.x && p.top < t.y + t.h && p.top + card.h > t.y;

describe('placeCard', () => {
  it('centres the card when nothing is highlighted', () => {
    const p = placeCard(null, card, vp);
    expect(p.side).toBe('center');
    expect(p.left).toBe(530); expect(p.top).toBe(315);
  });
  it('puts the card to the right of the tool rail', () => {
    const rail: Rect = { x: 0, y: 58, w: 68, h: 790 };
    const p = placeCard(rail, card, vp);
    expect(p.side).toBe('right'); expect(overlaps(p, rail)).toBe(false); expect(inView(p)).toBe(true);
  });
  it('puts the card to the left of the side panel', () => {
    const side: Rect = { x: 1048, y: 58, w: 352, h: 792 };
    const p = placeCard(side, card, vp);
    expect(p.side).toBe('left'); expect(overlaps(p, side)).toBe(false); expect(inView(p)).toBe(true);
  });
  it('puts the card below header buttons', () => {
    const present: Rect = { x: 955, y: 12, w: 90, h: 34 };
    const p = placeCard(present, card, vp);
    expect(p.side).toBe('bottom'); expect(p.top).toBeGreaterThan(46); expect(inView(p)).toBe(true);
  });
  it('floats inside a target that fills the screen', () => {
    const paper: Rect = { x: 68, y: 98, w: 980, h: 752 };
    const p = placeCard(paper, { w: 340, h: 220 }, { w: 1100, h: 850 });
    expect(['inside', 'left', 'right', 'bottom', 'top']).toContain(p.side);
    expect(inView(p, card, { w: 1100, h: 850 })).toBe(true);
  });
  it('docks to the top on phones when the target is in the lower half, bottom otherwise', () => {
    const phone = { w: 390, h: 800 };
    expect(placeCard({ x: 0, y: 700, w: 390, h: 50 }, { w: 366, h: 200 }, phone).side).toBe('dock-top');
    expect(placeCard({ x: 0, y: 0, w: 390, h: 52 }, { w: 366, h: 200 }, phone).side).toBe('dock-bottom');
  });
  it('never leaves the screen, wherever the target is', () => {
    for (const t of [{ x: 0, y: 0, w: 10, h: 10 }, { x: 1390, y: 840, w: 10, h: 10 }, { x: 700, y: 400, w: 20, h: 20 }, { x: 0, y: 0, w: 1400, h: 850 }]) {
      expect(inView(placeCard(t, card, vp))).toBe(true);
    }
  });
});

describe('tour content', () => {
  it('has unique ids, titles and bodies, starts and ends centred', () => {
    const ids = TOUR_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(TOUR_STEPS[0].target).toBeUndefined();
    expect(TOUR_STEPS.at(-1)!.target).toBeUndefined();
    for (const s of TOUR_STEPS) {
      expect(s.title.length).toBeGreaterThan(3);
      const body = typeof s.body === 'string' ? s.body : s.body({ signedIn: false, role: null });
      expect(body.length).toBeGreaterThan(20);
    }
  });
  it('tailors the account step to the role', () => {
    const acc = TOUR_STEPS.find((s) => s.id === 'account')!;
    const f = acc.body as (c: { signedIn: boolean; role: string | null }) => string;
    expect(f({ signedIn: false, role: null })).toMatch(/Sign in/);
    expect(f({ signedIn: true, role: 'tutor' })).toMatch(/publish/);
    expect(f({ signedIn: true, role: 'student' })).toMatch(/submit/);
  });
});
