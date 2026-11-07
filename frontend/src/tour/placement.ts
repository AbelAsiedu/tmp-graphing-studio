// Where to put the tour's explanation card so it never covers the thing it points at and never leaves the screen.

export interface Rect { x: number; y: number; w: number; h: number }
export interface Size { w: number; h: number }
export type Side = 'right' | 'left' | 'bottom' | 'top' | 'inside' | 'center' | 'dock-top' | 'dock-bottom';
export interface Placement { left: number; top: number; side: Side }

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

export function placeCard(target: Rect | null, card: Size, vp: Size, o: { gap?: number; margin?: number; narrow?: number } = {}): Placement {
  const gap = o.gap ?? 14, margin = o.margin ?? 12, narrow = o.narrow ?? 720;
  const centered: Placement = { left: Math.round((vp.w - card.w) / 2), top: Math.round((vp.h - card.h) / 2), side: 'center' };
  if (!target) return centered;

  // phones: a full-width card docked to whichever edge is farther from the highlighted thing
  if (vp.w <= narrow) {
    const targetMid = target.y + target.h / 2;
    return targetMid > vp.h / 2
      ? { left: margin, top: margin, side: 'dock-top' }
      : { left: margin, top: Math.max(margin, vp.h - card.h - margin), side: 'dock-bottom' };
  }

  const midY = target.y + target.h / 2, midX = target.x + target.w / 2;
  const fits: Record<'right' | 'left' | 'bottom' | 'top', Placement | null> = {
    right: target.x + target.w + gap + card.w <= vp.w - margin
      ? { left: target.x + target.w + gap, top: clamp(midY - card.h / 2, margin, vp.h - card.h - margin), side: 'right' } : null,
    left: target.x - gap - card.w >= margin
      ? { left: target.x - gap - card.w, top: clamp(midY - card.h / 2, margin, vp.h - card.h - margin), side: 'left' } : null,
    bottom: target.y + target.h + gap + card.h <= vp.h - margin
      ? { left: clamp(midX - card.w / 2, margin, vp.w - card.w - margin), top: target.y + target.h + gap, side: 'bottom' } : null,
    top: target.y - gap - card.h >= margin
      ? { left: clamp(midX - card.w / 2, margin, vp.w - card.w - margin), top: target.y - gap - card.h, side: 'top' } : null,
  };
  // header items → below; things on the left edge → right of them; everything else → left of it
  const order: Array<'right' | 'left' | 'bottom' | 'top'> =
    target.y < 90 ? ['bottom', 'left', 'right', 'top']
    : target.x < vp.w * 0.25 ? ['right', 'bottom', 'left', 'top']
    : ['left', 'bottom', 'right', 'top'];
  for (const s of order) { const p = fits[s]; if (p) return p; }

  // the target is huge (e.g. the whole paper): float the card inside it, near the middle
  return { left: clamp(midX - card.w / 2, margin, vp.w - card.w - margin), top: clamp(midY - card.h / 2, margin, vp.h - card.h - margin), side: 'inside' };
}
