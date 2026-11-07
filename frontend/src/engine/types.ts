// Core data model. Everything the user draws lives in "plot space": the coordinates of the
// graph paper itself (log10 units on logarithmic axes). Zooming and panning only change the View.

export interface Vec {
  x: number;
  y: number;
}

export type PaperKind =
  | 'cartesian'
  | 'millimetre'
  | 'polar'
  | 'semilogy'
  | 'semilogx'
  | 'loglog'
  | 'isometric'
  | 'dot'
  | 'blank';
export type PaperTone = 'white' | 'cream' | 'blue' | 'board';
export type AngleUnit = 'deg' | 'rad';

export interface PaperConfig {
  kind: PaperKind;
  tone: PaperTone;
  axes: boolean;
  numbers: boolean;
}

/** Centre of the canvas in plot space, and pixels per plot unit on each axis. */
export interface View {
  cx: number;
  cy: number;
  sx: number;
  sy: number;
}

export interface Style {
  color: string;
  width: number;
  dash: 'solid' | 'dashed' | 'dotted';
  fill: string | null;
  opacity: number;
  /** Construction line: can be hidden with one switch. */
  cons?: boolean;
}

interface Base {
  id: string;
  style: Style;
}
export type LineExt = 'none' | 'both' | 'ray';
export type Arrow = 'none' | 'end' | 'both';

export type Obj =
  | (Base & { t: 'stroke'; pts: Vec[] })
  | (Base & { t: 'line'; a: Vec; b: Vec; ext: LineExt; arrow: Arrow })
  | (Base & { t: 'circle'; c: Vec; r: number })
  | (Base & { t: 'arc'; c: Vec; r: number; a0: number; a1: number })
  | (Base & { t: 'polygon'; pts: Vec[]; closed: boolean })
  | (Base & { t: 'point'; p: Vec; label: string })
  | (Base & { t: 'text'; p: Vec; text: string; size: number })
  | (Base & { t: 'angle'; v: Vec; a: Vec; b: Vec; label: string });

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
export type NewObj = DistributiveOmit<Obj, 'id'>;

export interface Equation {
  id: string;
  text: string;
  color: string;
  visible: boolean;
  width: number;
  /** Optional domain (cartesian) or parameter range (polar / parametric). Empty = automatic. */
  dMin: string;
  dMax: string;
  keyPoints: boolean;
}

export type ChartKind = 'bar' | 'histogram' | 'polygon' | 'ogive' | 'pie' | 'line' | 'scatter' | 'box';

export interface ChartConfig {
  kind: ChartKind;
  title: string;
  xLabel: string;
  yLabel: string;
  data: string;
  binWidth: number;
}

export type InstrumentKind = 'ruler' | 'protractor' | 'set45' | 'set3060';
export interface Instrument {
  id: string;
  kind: InstrumentKind;
  x: number;
  y: number;
  angle: number; // radians, counter-clockwise
  size: number; // plot units (ruler length / protractor diameter / set-square leg)
}

export interface Page {
  id: string;
  name: string;
  paper: PaperConfig;
  view: View;
  objects: Obj[];
  equations: Equation[];
  params: Record<string, number>;
  instruments: Instrument[];
  chart: ChartConfig | null;
  nextLabel: number;
  showConstruction: boolean;
  angleUnit: AngleUnit;
}

/** What is stored as a board's `data`. */
export interface Doc {
  version: 1;
  pages: Page[];
}

export const isLogX = (k: PaperKind) => k === 'semilogx' || k === 'loglog';
export const isLogY = (k: PaperKind) => k === 'semilogy' || k === 'loglog';

let counter = 0;
export const uid = (prefix = 'o') =>
  `${prefix}${Date.now().toString(36)}${(counter++).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

/** "auto" resolves to the paper's ink colour (dark on light paper, white on the board). */
export const INK = 'auto';
export const PALETTE = ['#d64550', '#2f6fdb', '#1f9d6b', '#e08a00', '#8a4fd6', '#0e9aa7', '#c2185b', '#5d4037'];

export const defaultStyle = (over: Partial<Style> = {}): Style => ({
  color: INK,
  width: 2,
  dash: 'solid',
  fill: null,
  opacity: 1,
  ...over,
});

export function newPage(name = 'Page 1', kind: PaperKind = 'cartesian'): Page {
  const log = kind === 'semilogy' || kind === 'semilogx' || kind === 'loglog';
  return {
    id: uid('p'),
    name,
    paper: { kind, tone: 'white', axes: true, numbers: true },
    view: log ? { cx: 1, cy: 1, sx: 90, sy: 90 } : { cx: 0, cy: 0, sx: 40, sy: 40 },
    objects: [],
    equations: [],
    params: {},
    instruments: [],
    chart: null,
    nextLabel: 0,
    showConstruction: true,
    angleUnit: 'deg',
  };
}

export const newDoc = (): Doc => ({ version: 1, pages: [newPage()] });

export function paperDefaults(kind: PaperKind): { view: View } {
  return { view: newPage('x', kind).view };
}
