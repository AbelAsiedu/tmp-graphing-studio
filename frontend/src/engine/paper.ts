import { formatNum, niceStep } from './geometry';
import { isLogX, isLogY, type PaperConfig, type PaperTone, type View } from './types';

export interface Theme {
  bg: string;
  minor: string;
  mid: string;
  major: string;
  axis: string;
  text: string;
  ink: string;
  dark: boolean;
}

export const THEMES: Record<PaperTone, Theme> = {
  white: { bg: '#ffffff', minor: '#dcebe3', mid: '#b9d6c7', major: '#86b59d', axis: '#1a2b4a', text: '#1a2b4a', ink: '#1a2b4a', dark: false },
  cream: { bg: '#fbf6e8', minor: '#eadfc2', mid: '#d6c79d', major: '#b8a36c', axis: '#33291a', text: '#33291a', ink: '#27324a', dark: false },
  blue: { bg: '#f3f8ff', minor: '#dce8f8', mid: '#b8cdec', major: '#86a9d6', axis: '#12284a', text: '#12284a', ink: '#12284a', dark: false },
  board: { bg: '#13212f', minor: '#1d3145', mid: '#2a455f', major: '#46698b', axis: '#eef3f9', text: '#eef3f9', ink: '#f4f7fb', dark: true },
};

export const resolveColor = (c: string, t: Theme) => (c === 'auto' ? t.ink : c);

const FONT = '12px "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif';
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
export const sup = (n: number) =>
  (n < 0 ? '⁻' : '') + String(Math.abs(n)).split('').map((d) => SUP[Number(d)]).join('');

export interface PaperOpts {
  hideX?: boolean;
  hideY?: boolean;
  noAxes?: boolean;
}

export function drawPaper(ctx: CanvasRenderingContext2D, paper: PaperConfig, view: View, w: number, h: number, o: PaperOpts = {}): Theme {
  const th = THEMES[paper.tone];
  ctx.save();
  ctx.fillStyle = th.bg;
  ctx.fillRect(0, 0, w, h);

  const tx = (x: number) => w / 2 + (x - view.cx) * view.sx;
  const ty = (y: number) => h / 2 - (y - view.cy) * view.sy;
  const x0 = view.cx - w / (2 * view.sx), x1 = view.cx + w / (2 * view.sx);
  const y0 = view.cy - h / (2 * view.sy), y1 = view.cy + h / (2 * view.sy);
  const logX = isLogX(paper.kind), logY = isLogY(paper.kind);
  const kind = paper.kind;

  ctx.lineCap = 'butt';
  const stroke = (color: string, width: number, draw: () => void) => {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); draw(); ctx.stroke();
  };

  // ---- vertical / horizontal families --------------------------------------------------
  type Fam = { step: number; sub: number; mid?: number };
  const linearFam = (scale: number, mm: boolean): Fam => {
    const step = niceStep(70 / scale);
    const m = step / Math.pow(10, Math.floor(Math.log10(step)));
    const sub = mm ? 10 : m === 2 ? 4 : 5;
    return { step, sub, mid: mm ? 5 : undefined };
  };

  const drawLinear = (axis: 'x' | 'y', fam: Fam) => {
    const lo = axis === 'x' ? x0 : y0, hi = axis === 'x' ? x1 : y1;
    const scale = axis === 'x' ? view.sx : view.sy;
    const minorStep = fam.step / fam.sub;
    const pxMinor = minorStep * scale;
    if (pxMinor < 3) return;
    const k0 = Math.ceil(lo / minorStep), k1 = Math.floor(hi / minorStep);
    if (k1 - k0 > 4000) return;
    const buckets: Record<'minor' | 'mid' | 'major', number[]> = { minor: [], mid: [], major: [] };
    for (let k = k0; k <= k1; k++) {
      const cls = k % fam.sub === 0 ? 'major' : fam.mid && k % fam.mid === 0 ? 'mid' : 'minor';
      if (cls === 'minor' && pxMinor < 6) continue;
      buckets[cls].push(k * minorStep);
    }
    for (const cls of ['minor', 'mid', 'major'] as const) {
      if (!buckets[cls].length) continue;
      stroke(th[cls], cls === 'major' ? 1.1 : cls === 'mid' ? 0.9 : 0.6, () => {
        for (const val of buckets[cls]) {
          if (axis === 'x') { const px = Math.round(tx(val)) + 0.5; ctx.moveTo(px, 0); ctx.lineTo(px, h); }
          else { const py = Math.round(ty(val)) + 0.5; ctx.moveTo(0, py); ctx.lineTo(w, py); }
        }
      });
    }
  };

  const drawLog = (axis: 'x' | 'y') => {
    const lo = axis === 'x' ? x0 : y0, hi = axis === 'x' ? x1 : y1;
    const scale = axis === 'x' ? view.sx : view.sy;
    const minors = scale >= 60;
    const tick = (val: number, major: boolean) => {
      const p = axis === 'x' ? Math.round(tx(val)) + 0.5 : Math.round(ty(val)) + 0.5;
      return { p, major };
    };
    const lines: { p: number; major: boolean }[] = [];
    for (let k = Math.floor(lo); k <= Math.ceil(hi); k++) {
      lines.push(tick(k, true));
      if (minors) for (let m = 2; m <= 9; m++) lines.push(tick(k + Math.log10(m), false));
      if (lines.length > 3000) break;
    }
    for (const major of [false, true]) {
      stroke(major ? th.major : th.minor, major ? 1.2 : 0.7, () => {
        for (const l of lines) {
          if (l.major !== major) continue;
          if (axis === 'x') { ctx.moveTo(l.p, 0); ctx.lineTo(l.p, h); } else { ctx.moveTo(0, l.p); ctx.lineTo(w, l.p); }
        }
      });
    }
  };

  switch (kind) {
    case 'cartesian':
    case 'millimetre':
    case 'dot': {
      const mm = kind === 'millimetre';
      const fx = linearFam(view.sx, mm), fy = linearFam(view.sy, mm);
      if (kind === 'dot') {
        const sx = fx.step / fx.sub, sy = fy.step / fy.sub;
        ctx.fillStyle = th.major;
        if ((x1 - x0) / sx * ((y1 - y0) / sy) < 60000 && sx * view.sx >= 6 && sy * view.sy >= 6) {
          for (let i = Math.ceil(x0 / sx); i <= Math.floor(x1 / sx); i++)
            for (let j = Math.ceil(y0 / sy); j <= Math.floor(y1 / sy); j++) {
              const major = i % fx.sub === 0 && j % fy.sub === 0;
              ctx.beginPath(); ctx.arc(tx(i * sx), ty(j * sy), major ? 1.9 : 1.1, 0, Math.PI * 2); ctx.fill();
            }
        }
      } else {
        drawLinear('x', fx); drawLinear('y', fy);
      }
      break;
    }
    case 'semilogy': drawLinear('x', linearFam(view.sx, false)); drawLog('y'); break;
    case 'semilogx': drawLog('x'); drawLinear('y', linearFam(view.sy, false)); break;
    case 'loglog': drawLog('x'); drawLog('y'); break;
    case 'isometric': {
      const step = niceStep(60 / view.sx) / (view.sx > 90 ? 1 : 1);
      const hStep = (step * Math.sqrt(3)) / 2;
      const s3 = Math.sqrt(3);
      stroke(th.mid, 0.8, () => {
        for (let j = Math.ceil(y0 / hStep); j <= Math.floor(y1 / hStep); j++) { const py = ty(j * hStep); ctx.moveTo(0, py); ctx.lineTo(w, py); }
        for (const sign of [1, -1]) {
          const ks = [x0 - sign * y0 / s3, x0 - sign * y1 / s3, x1 - sign * y0 / s3, x1 - sign * y1 / s3].map((v) => v / step);
          for (let k = Math.floor(Math.min(...ks)); k <= Math.ceil(Math.max(...ks)); k++) {
            if (Math.abs(k) > 3000) break;
            ctx.moveTo(tx(k * step + sign * y0 / s3), ty(y0));
            ctx.lineTo(tx(k * step + sign * y1 / s3), ty(y1));
          }
        }
      });
      break;
    }
    case 'polar': {
      const ox = tx(0), oy = ty(0);
      const step = niceStep(70 / view.sx);
      const m = step / Math.pow(10, Math.floor(Math.log10(step)));
      const sub = m === 2 ? 4 : 5;
      const far = Math.max(Math.hypot(x0, y0), Math.hypot(x0, y1), Math.hypot(x1, y0), Math.hypot(x1, y1));
      const minorR = step / sub;
      const ring = (r: number) => { ctx.moveTo(ox + r * view.sx, oy); ctx.ellipse(ox, oy, r * view.sx, r * view.sy, 0, 0, Math.PI * 2); };
      if (far / minorR < 500) {
        if (minorR * view.sx >= 7) stroke(th.minor, 0.6, () => { for (let k = 1; k * minorR <= far; k++) if (k % sub) ring(k * minorR); });
        stroke(th.major, 1.1, () => { for (let k = 1; k * step <= far; k++) ring(k * step); });
      }
      const L = Math.hypot(w, h) * 2;
      stroke(th.minor, 0.8, () => {
        for (let a = 0; a < 360; a += 15) { if (a % 30 === 0) continue; const r = (a * Math.PI) / 180; ctx.moveTo(ox, oy); ctx.lineTo(ox + L * Math.cos(r), oy - L * Math.sin(r)); }
      });
      stroke(th.mid, 1, () => {
        for (let a = 0; a < 360; a += 30) { const r = (a * Math.PI) / 180; ctx.moveTo(ox, oy); ctx.lineTo(ox + L * Math.cos(r), oy - L * Math.sin(r)); }
      });
      // angle labels on the largest ring that fits comfortably
      const fit = Math.min(w, h) / 2 / Math.max(view.sx, view.sy) * 0.86;
      const R = Math.max(step, Math.floor(fit / step) * step);
      if (ox > -w && ox < 2 * w && oy > -h && oy < 2 * h && paper.numbers) {
        ctx.font = FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = th.text;
        for (let a = 0; a < 360; a += 30) {
          const r = (a * Math.PI) / 180;
          const px = ox + (R * view.sx + 16) * Math.cos(r), py = oy - (R * view.sy + 12) * Math.sin(r);
          if (px > 0 && px < w && py > 0 && py < h) ctx.fillText(`${a}°`, px, py);
        }
      }
      break;
    }
    case 'blank': break;
  }

  // ---- axes & numbers -----------------------------------------------------------------
  if (!o.noAxes && paper.axes) {
    ctx.strokeStyle = th.axis; ctx.fillStyle = th.axis; ctx.lineWidth = 1.6;
    const xAxis = !logY && y0 <= 0 && y1 >= 0;
    const yAxis = !logX && x0 <= 0 && x1 >= 0;
    if (xAxis) { ctx.beginPath(); ctx.moveTo(0, ty(0)); ctx.lineTo(w, ty(0)); ctx.stroke(); arrow(ctx, w - 2, ty(0), 0); }
    if (yAxis) { ctx.beginPath(); ctx.moveTo(tx(0), h); ctx.lineTo(tx(0), 0); ctx.stroke(); arrow(ctx, tx(0), 2, -Math.PI / 2); }
    ctx.font = 'italic 14px Georgia, "Times New Roman", serif'; ctx.textBaseline = 'alphabetic';
    if (xAxis) { ctx.textAlign = 'right'; halo(ctx, 'x', w - 8, ty(0) - 8, th); }
    if (yAxis) { ctx.textAlign = 'left'; halo(ctx, 'y', tx(0) + 8, 16, th); }
  }

  if (paper.numbers) {
    ctx.font = FONT;
    const bottomY = !logY && y0 <= 0 && y1 >= 0 && paper.axes ? Math.min(h - 6, ty(0) + 14) : h - 6;
    const leftX = !logX && x0 <= 0 && x1 >= 0 && paper.axes ? Math.max(30, tx(0) - 6) : 30;
    if (!o.hideX && kind !== 'polar') {
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      if (logX) logLabels(ctx, 'x', x0, x1, view.sx, tx, bottomY, th);
      else {
        const step = niceStep(70 / view.sx);
        for (let k = Math.ceil(x0 / step); k <= Math.floor(x1 / step); k++) {
          if (k === 0 && !logY && paper.axes && x0 <= 0 && x1 >= 0) continue; // origin label drawn once below
          halo(ctx, formatNum(k * step, step), tx(k * step), bottomY, th);
        }
      }
    }
    if (!o.hideY && kind !== 'polar') {
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      if (logY) logLabels(ctx, 'y', y0, y1, view.sy, ty, leftX, th);
      else {
        const step = niceStep(40 / view.sy);
        for (let k = Math.ceil(y0 / step); k <= Math.floor(y1 / step); k++) {
          if (k === 0 && !logX && paper.axes && x0 <= 0 && x1 >= 0) continue;
          halo(ctx, formatNum(k * step, step), leftX, ty(k * step), th);
        }
      }
    }
    if (kind === 'polar') {
      const step = niceStep(70 / view.sx);
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      for (let k = 1; k * step <= x1; k++) if (tx(k * step) > 0) halo(ctx, formatNum(k * step, step), tx(k * step) + 2, ty(0) + 14, th);
    }
    const originVisible = x0 <= 0 && x1 >= 0 && y0 <= 0 && y1 >= 0;
    if (originVisible && paper.axes && !logX && !logY && !o.hideX && !o.hideY && kind !== 'polar') {
      ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
      halo(ctx, '0', tx(0) - 5, ty(0) + 14, th);
    }
  }
  ctx.restore();
  return th;
}

function logLabels(ctx: CanvasRenderingContext2D, axis: 'x' | 'y', lo: number, hi: number, scale: number, to: (v: number) => number, fixed: number, th: Theme) {
  const every = Math.max(1, Math.ceil(46 / scale));
  for (let k = Math.floor(lo); k <= Math.ceil(hi); k++) {
    if (k % every) continue;
    const label = k >= -3 && k <= 5 ? String(Math.pow(10, k)) : `10${sup(k)}`;
    const p = to(k);
    if (axis === 'x') halo(ctx, label, p, fixed, th); else halo(ctx, label, fixed, p, th);
    if (scale >= 140) for (const m of [2, 5]) {
      const q = to(k + Math.log10(m));
      const lab = String(m * Math.pow(10, k));
      if (k >= -3 && k <= 4) { if (axis === 'x') halo(ctx, lab, q, fixed, th); else halo(ctx, lab, fixed, q, th); }
    }
  }
}

export function halo(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, th: Theme) {
  ctx.lineJoin = 'round'; ctx.lineWidth = 3.5; ctx.strokeStyle = th.bg; ctx.strokeText(text, x, y);
  ctx.fillStyle = th.text; ctx.fillText(text, x, y);
}

function arrow(ctx: CanvasRenderingContext2D, x: number, y: number, ang: number) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-9, -4.5); ctx.lineTo(-9, 4.5); ctx.closePath(); ctx.fill(); ctx.restore();
}
