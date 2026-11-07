import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { placeCard, type Rect } from './placement';
import { TOUR_STEPS, type TourCtx, type TourTab } from './steps';

interface Props {
  ctx: TourCtx;
  /** Open a side-panel tab for the step (null = close the panel sheet on phones). */
  goTab: (tab: TourTab | null) => void;
  /** Run a step's "try it" action. */
  onAction: (id: 'plot-example') => void;
  onClose: (how: 'finished' | 'skipped') => void;
}

const PAD = 6;
const sameRect = (a: Rect | null, b: Rect | null) =>
  a === b || (!!a && !!b && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5);

/**
 * A guided tour: dims the page, spotlights one real control at a time and explains it.
 * Keyboard: → / Enter next, ← back, Esc skip. The page behind is inert while it is open.
 */
export function Tour({ ctx, goTab, onAction, onClose }: Props) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [done, setDone] = useState<Record<string, boolean>>({});
  const cardRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  const step = TOUR_STEPS[i];
  const last = i === TOUR_STEPS.length - 1;
  const body = typeof step.body === 'function' ? step.body(ctx) : step.body;

  const next = useCallback(() => (last ? onClose('finished') : setI((n) => n + 1)), [last, onClose]);
  const back = useCallback(() => setI((n) => Math.max(0, n - 1)), []);
  const skip = useCallback(() => onClose(last ? 'finished' : 'skipped'), [last, onClose]);

  // make the rest of the page unreachable (mouse, keyboard and screen readers) while the tour is open
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const root = document.getElementById('root');
    root?.setAttribute('inert', '');
    return () => { root?.removeAttribute('inert'); setTimeout(() => prev?.focus?.({ preventScroll: true }), 0); };
  }, []);

  // open the right panel for this step, then follow the target while the layout settles (sheet animation etc.)
  useEffect(() => {
    goTab(step.tab ?? null);
    let raf = 0;
    const t0 = performance.now();
    const measure = () => {
      const el = step.target ? document.querySelector<HTMLElement>(step.target) : null;
      const r = el?.getBoundingClientRect();
      const ok = !!r && r.width > 2 && r.height > 2 && r.bottom > 0 && r.right > 0 && r.top < window.innerHeight && r.left < window.innerWidth;
      const next: Rect | null = ok && r ? { x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2 } : null;
      setRect((cur) => (sameRect(cur, next) ? cur : next));
      if (performance.now() - t0 < 600) raf = requestAnimationFrame(measure);
    };
    measure();
    const onResize = () => { setVp({ w: window.innerWidth, h: window.innerHeight }); cancelAnimationFrame(raf); const t = performance.now(); const again = () => { measure(); if (performance.now() - t < 100) raf = requestAnimationFrame(again); }; again(); };
    window.addEventListener('resize', onResize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  // measure the card so it can be placed without covering the highlight
  useLayoutEffect(() => {
    const b = cardRef.current?.getBoundingClientRect();
    if (b && (Math.abs(b.width - size.w) > 1 || Math.abs(b.height - size.h) > 1)) setSize({ w: b.width, h: b.height });
  });


  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); skip(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
      else if (e.key === 'Tab') {
        // keep focus inside the card
        const f = cardRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])');
        if (!f || !f.length) return;
        const first = f[0], lastEl = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); lastEl.focus(); }
        else if (!e.shiftKey && document.activeElement === lastEl) { e.preventDefault(); first.focus(); }
        else if (!cardRef.current?.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [skip, next, back]);

  const place = size.w ? placeCard(rect, size, vp) : null;
  const ready = !!place;
  useEffect(() => { if (ready) nextRef.current?.focus({ preventScroll: true }); }, [i, ready]);
  const docked = place?.side === 'dock-top' || place?.side === 'dock-bottom';
  const act = step.action;

  return createPortal(
    <div className="tour">
      {rect ? <div className="tour-hole" style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }} /> : <div className="tour-dim" />}
      <div
        ref={cardRef}
        className={`tour-card${docked ? ' dock' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        style={{ left: place?.left ?? 0, top: place?.top ?? 0, visibility: place ? 'visible' : 'hidden' }}
      >
        <div className="tour-head">
          <span className="tour-step">{i === 0 ? 'Quick tour' : last ? 'All done' : `Step ${i} of ${TOUR_STEPS.length - 2}`}</span>
          <button className="icon" onClick={skip} aria-label="Close the tour">✕</button>
        </div>
        <div aria-live="polite">
          <h2 id="tour-title">{step.title}</h2>
          <p id="tour-body">{body}</p>
        </div>
        {act && (
          <button className="btn sm tour-action" disabled={!!done[step.id]} onClick={() => { onAction(act.id); setDone((d) => ({ ...d, [step.id]: true })); }}>
            {done[step.id] ? act.done : act.label}
          </button>
        )}
        <div className="tour-dots" aria-hidden="true">
          {TOUR_STEPS.map((s, k) => <i key={s.id} className={k === i ? 'on' : k < i ? 'seen' : ''} />)}
        </div>
        <div className="tour-foot">
          {!last ? <button className="tour-skip" onClick={skip}>Skip tour</button> : <span />}
          <div className="row gap">
            {i > 0 && <button className="btn" onClick={back}>Back</button>}
            <button ref={nextRef} className="btn gold" onClick={next}>{i === 0 ? 'Start the tour' : last ? 'Start drawing' : 'Next'}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
