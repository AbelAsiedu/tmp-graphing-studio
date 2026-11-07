import { useMemo, useRef, useState } from 'react';
import { CONSTRUCT_TOOLS } from '../engine/constructions';
import { exportImage, exportJSON, exportPDF, parseDocFile } from '../engine/export';
import { formatNum, niceStep, deg, rad } from '../engine/geometry';
import { INSTRUMENT_LABEL, makeInstrument } from '../engine/instruments';
import { compileEquation, equationParams, paramDefaults } from '../engine/plot';
import { chartFor } from '../engine/render';
import { summarize } from '../engine/stats';
import {
  PALETTE, defaultStyle, isLogX, isLogY, uid,
  type ChartConfig, type ChartKind, type Equation, type InstrumentKind, type PaperKind, type PaperTone,
} from '../engine/types';
import { useStore } from '../store';
import type { ToolId, ToolOpts } from '../toolTypes';
import type { StageHandle } from './CanvasStage';

export interface PanelCtx {
  stage: React.RefObject<StageHandle | null>;
  opts: ToolOpts;
  setOpts: (o: ToolOpts) => void;
  tool: ToolId;
  setTool: (t: ToolId) => void;
  selInst: string | null;
  setSelInst: (id: string | null) => void;
  toast: (m: string) => void;
  present: () => void;
}

const num = (s: string, fallback = 0) => { const n = parseFloat(s); return Number.isFinite(n) ? n : fallback; };

function Section({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) {
  return (
    <section className="sec">
      <h3>{title}</h3>
      {hint && <p className="muted small">{hint}</p>}
      {children}
    </section>
  );
}

// =========================================================================== GRAPH
const PRESETS: { label: string; text: string; group: string }[] = [
  { group: 'Algebra', label: 'Straight line', text: 'y = mx + c' },
  { group: 'Algebra', label: 'Quadratic', text: 'y = ax^2 + bx + c' },
  { group: 'Algebra', label: 'Cubic', text: 'y = x^3 - 3x' },
  { group: 'Algebra', label: 'Polynomial (factorised)', text: 'y = (x + 2)(x - 1)(x - 3)' },
  { group: 'Algebra', label: 'Reciprocal', text: 'y = 1/x' },
  { group: 'Algebra', label: 'Vertical line', text: 'x = 3' },
  { group: 'Algebra', label: 'Inequality', text: 'y > x + 1' },
  { group: 'Trigonometry', label: 'Sine', text: 'y = a sin(bx)' },
  { group: 'Trigonometry', label: 'Cosine', text: 'y = a cos(x)' },
  { group: 'Trigonometry', label: 'Tangent', text: 'y = tan(x)' },
  { group: 'Growth', label: 'Exponential', text: 'y = 2^x' },
  { group: 'Growth', label: 'Logarithm', text: 'y = log(x)' },
  { group: 'Curves', label: 'Circle', text: 'x^2 + y^2 = 25' },
  { group: 'Curves', label: 'Ellipse', text: 'x^2/16 + y^2/9 = 1' },
  { group: 'Curves', label: 'Rose (polar)', text: 'r = 3cos(3theta)' },
  { group: 'Curves', label: 'Cardioid (polar)', text: 'r = 2 + 2cos(theta)' },
  { group: 'Curves', label: 'Spiral (parametric)', text: '(t cos(t), t sin(t))' },
];
const PARAM_DEFAULTS: Record<string, number> = { m: 1, c: 0, a: 1, b: 1, k: 1, h: 0 };

export function GraphPanel({ ctx }: { ctx: PanelCtx }) {
  const s = useStore();
  const page = s.page;
  const params = useMemo(() => equationParams(page.equations, page.angleUnit), [page.equations, page.angleUnit]);
  const [tableOpen, setTableOpen] = useState(false);
  const [tFrom, setTFrom] = useState('-3'), [tTo, setTTo] = useState('3'), [tStep, setTStep] = useState('1');

  const patch = (id: string, over: Partial<Equation>, key = '') =>
    s.update((p) => ({ ...p, equations: p.equations.map((e) => (e.id === id ? { ...e, ...over } : e)) }), key || `eq:${id}`);
  const addEq = (text = '') => {
    const color = PALETTE[page.equations.length % PALETTE.length];
    const eq: Equation = { id: uid('e'), text, color, visible: true, width: 2.6, dMin: '', dMax: '', keyPoints: false };
    s.update((p) => {
      const names = compileEquation(text, p.angleUnit).parsed?.params ?? [];
      const params = { ...p.params };
      for (const n of names) if (!(n in params)) params[n] = PARAM_DEFAULTS[n] ?? 1;
      return { ...p, params, equations: [...p.equations, eq] };
    });
  };
  const setParam = (name: string, value: number) => s.update((p) => ({ ...p, params: { ...p.params, [name]: value } }), `param:${name}`);

  const firstCartesian = page.equations.find((e) => compileEquation(e.text, page.angleUnit).parsed?.kind === 'cartesian');
  const table = useMemo(() => {
    if (!tableOpen || !firstCartesian) return [];
    const parsed = compileEquation(firstCartesian.text, page.angleUnit).parsed;
    if (parsed?.kind !== 'cartesian') return [];
    const a = num(tFrom, -3), b = num(tTo, 3), st = Math.max(num(tStep, 1), 1e-6);
    const env = paramDefaults(parsed.params, page.params);
    const rows: { x: number; y: number }[] = [];
    for (let x = a; x <= b + 1e-9 && rows.length < 60; x += st) { env.x = x; rows.push({ x: Number(x.toFixed(10)), y: parsed.f(env) }); }
    return rows;
  }, [tableOpen, firstCartesian, page.angleUnit, page.params, tFrom, tTo, tStep]);

  return (
    <div className="panel-body">
      <Section title="Equations" hint="Type like a textbook: y = 2x + 1 · y = x^2 - 4x + 3 · y = 3sin(2x) · x^2 + y^2 = 25 · r = 2 + 2cos(theta) · y > x">
        {page.equations.map((eq) => {
          const { error } = compileEquation(eq.text, page.angleUnit);
          return (
            <div className="eq" key={eq.id}>
              <div className="eq-row">
                <button className="swatch" style={{ background: eq.color }} title="Change colour" aria-label="Change colour"
                  onClick={() => patch(eq.id, { color: PALETTE[(PALETTE.indexOf(eq.color) + 1) % PALETTE.length] }, 'color')} />
                <input className="mono grow" value={eq.text} placeholder="y = …" spellCheck={false} autoCapitalize="off" autoCorrect="off"
                  onChange={(e) => {
                    const text = e.target.value;
                    patch(eq.id, { text });
                    const names = compileEquation(text, page.angleUnit).parsed?.params ?? [];
                    for (const n of names) if (!(n in page.params)) setParam(n, PARAM_DEFAULTS[n] ?? 1);
                  }}
                  aria-label="Equation" aria-invalid={!!error && !!eq.text.trim()} />
                <button className={`icon ${eq.visible ? 'on' : ''}`} title={eq.visible ? 'Hide' : 'Show'} aria-pressed={eq.visible} onClick={() => patch(eq.id, { visible: !eq.visible }, 'vis')}>👁</button>
                <button className={`icon ${eq.keyPoints ? 'on' : ''}`} title="Show intercepts, turning points and intersections" aria-pressed={eq.keyPoints} onClick={() => patch(eq.id, { keyPoints: !eq.keyPoints }, 'kp')}>◎</button>
                <button className="icon" title="Draw the curve step by step" onClick={() => ctx.stage.current?.animate(eq.id)}>▶</button>
                <button className="icon" title="Delete" onClick={() => s.update((p) => ({ ...p, equations: p.equations.filter((e) => e.id !== eq.id) }))}>✕</button>
              </div>
              {error && eq.text.trim() && <div className="err">{error}</div>}
              <details className="adv">
                <summary>Range &amp; thickness</summary>
                <div className="row gap">
                  <label>from<input className="narrow" value={eq.dMin} placeholder="auto" onChange={(e) => patch(eq.id, { dMin: e.target.value })} /></label>
                  <label>to<input className="narrow" value={eq.dMax} placeholder="auto" onChange={(e) => patch(eq.id, { dMax: e.target.value })} /></label>
                  <label>width<input type="range" min="1" max="8" step="0.5" value={eq.width} onChange={(e) => patch(eq.id, { width: num(e.target.value, 2) })} /></label>
                </div>
                <p className="muted small">Range limits x for y = f(x), or θ / t for polar and parametric curves.</p>
              </details>
            </div>
          );
        })}
        <div className="row gap">
          <button className="btn" onClick={() => addEq('')}>＋ Add equation</button>
          <select className="grow" value="" onChange={(e) => { const p = PRESETS.find((x) => x.text === e.target.value); if (p) addEq(p.text); }} aria-label="Add a standard graph">
            <option value="">Standard graphs…</option>
            {[...new Set(PRESETS.map((p) => p.group))].map((g) => (
              <optgroup key={g} label={g}>{PRESETS.filter((p) => p.group === g).map((p) => <option key={p.text} value={p.text}>{p.label} — {p.text}</option>)}</optgroup>
            ))}
          </select>
        </div>
        <div className="row gap center-v">
          <span className="muted small">Angles in</span>
          <div className="seg" role="group" aria-label="Angle unit">
            {(['deg', 'rad'] as const).map((u) => (
              <button key={u} className={page.angleUnit === u ? 'on' : ''} onClick={() => s.update((p) => ({ ...p, angleUnit: u }))}>{u === 'deg' ? 'Degrees' : 'Radians'}</button>
            ))}
          </div>
        </div>
      </Section>

      {params.length > 0 && (
        <Section title="Sliders" hint="Change a letter and watch the graph move.">
          {params.map((name) => {
            const val = page.params[name] ?? PARAM_DEFAULTS[name] ?? 1;
            const max = Math.max(10, Math.ceil(Math.abs(val) * 1.5));
            return (
              <div className="slider" key={name}>
                <span className="mono pname">{name}</span>
                <input type="range" min={-max} max={max} step="0.1" value={val} onChange={(e) => setParam(name, parseFloat(e.target.value))} aria-label={`Value of ${name}`} />
                <input className="narrow" value={String(Number(val.toFixed(3)))} onChange={(e) => { const n = parseFloat(e.target.value); if (Number.isFinite(n)) setParam(name, n); }} aria-label={`${name} exact value`} />
              </div>
            );
          })}
        </Section>
      )}

      <Section title="Table of values">
        <button className="btn" onClick={() => setTableOpen((o) => !o)} disabled={!firstCartesian}>{tableOpen ? 'Hide table' : 'Show table for first y = f(x)'}</button>
        {tableOpen && firstCartesian && (
          <>
            <div className="row gap">
              <label>x from<input className="narrow" value={tFrom} onChange={(e) => setTFrom(e.target.value)} /></label>
              <label>to<input className="narrow" value={tTo} onChange={(e) => setTTo(e.target.value)} /></label>
              <label>step<input className="narrow" value={tStep} onChange={(e) => setTStep(e.target.value)} /></label>
            </div>
            <div className="table-wrap"><table className="data"><thead><tr><th>x</th><th>y</th></tr></thead>
              <tbody>{table.map((r, i) => <tr key={i}><td>{formatNum(r.x, 0.001)}</td><td>{Number.isFinite(r.y) ? formatNum(r.y, 0.001) : '—'}</td></tr>)}</tbody></table></div>
            <button className="btn" onClick={() => {
              const pts = table.filter((r) => Number.isFinite(r.y));
              s.update((p) => ({ ...p, objects: [...p.objects, ...pts.map((r) => ({ id: uid(), t: 'point' as const, p: { x: r.x, y: r.y }, label: '', style: defaultStyle({ color: firstCartesian.color, width: 2 }) }))] }));
              ctx.toast(`${pts.length} points plotted`);
            }}>Plot these points</button>
          </>
        )}
      </Section>
    </div>
  );
}

// =========================================================================== DRAW
const INSTRUMENTS: InstrumentKind[] = ['ruler', 'protractor', 'set45', 'set3060'];

export function DrawPanel({ ctx }: { ctx: PanelCtx }) {
  const s = useStore();
  const page = s.page;
  const inst = page.instruments.find((i) => i.id === ctx.selInst) ?? null;
  const activeC = ctx.tool.startsWith('c:') ? ctx.tool.slice(2) : '';
  const o = ctx.opts;
  const setO = (over: Partial<ToolOpts>) => ctx.setOpts({ ...o, ...over });
  const patchInst = (over: Partial<NonNullable<typeof inst>>) => inst && s.update((p) => ({ ...p, instruments: p.instruments.map((i) => (i.id === inst.id ? { ...i, ...over } : i)) }), `inst:${inst.id}`);

  return (
    <div className="panel-body">
      <Section title="Instruments" hint="Drag to move, drag the ↻ handle to turn. Pick the Pencil or Line tool and start on an edge to draw along it.">
        <div className="grid2">
          {INSTRUMENTS.map((k) => (
            <button key={k} className="btn" onClick={() => {
              const { w, h } = ctx.stage.current?.size() ?? { w: 800, h: 600 };
              const i = makeInstrument(k, page.view, w, h, page.instruments.length);
              s.update((p) => ({ ...p, instruments: [...p.instruments, i] }));
              ctx.setSelInst(i.id);
            }}>＋ {INSTRUMENT_LABEL[k]}</button>
          ))}
        </div>
        {page.instruments.length > 0 && (
          <div className="inst-list">
            {page.instruments.map((i) => (
              <button key={i.id} className={`chip ${ctx.selInst === i.id ? 'on' : ''}`} onClick={() => ctx.setSelInst(i.id)}>{INSTRUMENT_LABEL[i.kind]}</button>
            ))}
          </div>
        )}
        {inst && (
          <div className="card">
            <div className="row gap center-v"><strong>{INSTRUMENT_LABEL[inst.kind]}</strong><span className="grow" />
              <button className="btn danger" onClick={() => { s.update((p) => ({ ...p, instruments: p.instruments.filter((i) => i.id !== inst.id) })); ctx.setSelInst(null); }}>Remove</button></div>
            <div className="row gap center-v">
              <label>Angle<input className="narrow" value={String(Number(deg(inst.angle).toFixed(1)))} onChange={(e) => { const n = parseFloat(e.target.value); if (Number.isFinite(n)) patchInst({ angle: rad(n) }); }} />°</label>
              {[-15, -5, -1, 1, 5, 15].map((d) => <button key={d} className="btn sm" onClick={() => patchInst({ angle: inst.angle + rad(d) })}>{d > 0 ? '+' : ''}{d}</button>)}
            </div>
            <div className="row gap center-v">
              <label>Size<input className="narrow" value={String(inst.size)} onChange={(e) => { const n = parseFloat(e.target.value); if (n > 0) patchInst({ size: n }); }} /> units</label>
              <span className="muted small">Position</span>
              {([['←', -1, 0], ['→', 1, 0], ['↑', 0, 1], ['↓', 0, -1]] as const).map(([t, dx, dy]) => {
                const step = niceStep(70 / page.view.sx) / 10;
                return <button key={t} className="btn sm" onClick={() => patchInst({ x: inst.x + dx * step, y: inst.y + dy * step })}>{t}</button>;
              })}
            </div>
          </div>
        )}
      </Section>

      <Section title="Compass">
        <label className="row gap center-v">Fixed radius
          <input className="narrow" placeholder="free" value={o.compassRadius} onChange={(e) => setO({ compassRadius: e.target.value })} /> units
        </label>
        <button className={`btn ${ctx.tool === 'compass' ? 'on' : ''}`} onClick={() => ctx.setTool('compass')}>⌓ Use compass</button>
        <p className="muted small">Click the centre, then press and drag around it. With a fixed radius, press anywhere to start the arc.</p>
      </Section>

      <Section title="Constructions" hint="Click the points; the compass arcs are drawn for you.">
        <div className="list">
          {CONSTRUCT_TOOLS.map((t) => (
            <button key={t.id} className={`list-btn ${activeC === t.id ? 'on' : ''}`} onClick={() => ctx.setTool(`c:${t.id}`)}>{t.label}</button>
          ))}
        </div>
        {activeC === 'polygon' && <label className="row gap center-v">Sides<input type="number" min="3" max="30" className="narrow" value={o.sides} onChange={(e) => setO({ sides: num(e.target.value, 5) })} /></label>}
        {activeC === 'angle' && <label className="row gap center-v">Angle<input type="number" className="narrow" value={o.angleDeg} onChange={(e) => setO({ angleDeg: num(e.target.value, 60) })} />°</label>}
        {activeC === 'sss' && (
          <div className="row gap center-v">
            {(['a', 'b', 'c'] as const).map((l, i) => (
              <label key={l}>{l}<input type="number" min="0" step="0.5" className="narrow" value={o.sss[i]} onChange={(e) => { const next = [...o.sss] as [number, number, number]; next[i] = num(e.target.value, 1); setO({ sss: next }); }} /></label>
            ))}
            <span className="muted small">a = BC, b = CA, c = AB</span>
          </div>
        )}
        {CONSTRUCT_TOOLS.find((t) => t.id === activeC)?.info && <p className="note">{CONSTRUCT_TOOLS.find((t) => t.id === activeC)!.info}</p>}
        <label className="check"><input type="checkbox" checked={page.showConstruction} onChange={(e) => s.update((p) => ({ ...p, showConstruction: e.target.checked }))} /> Show construction arcs &amp; lines</label>
        <button className="btn" onClick={() => s.update((p) => ({ ...p, objects: p.objects.filter((x) => !x.style.cons) }))}>Remove construction arcs</button>
      </Section>
    </div>
  );
}

// =========================================================================== CHARTS
const KINDS: { id: ChartKind; label: string; sample: string; help: string }[] = [
  { id: 'bar', label: 'Bar chart', sample: 'Maths, 45\nEnglish, 38\nScience, 52\nSocial Studies, 30', help: 'One "label, value" per line.' },
  { id: 'pie', label: 'Pie chart', sample: 'Football, 12\nNetball, 8\nAthletics, 4\nChess, 6', help: 'One "label, value" per line. Angles are worked out for you.' },
  { id: 'line', label: 'Line graph', sample: 'Mon, 22\nTue, 25\nWed, 21\nThu, 27\nFri, 30', help: 'One "label, value" per line.' },
  { id: 'histogram', label: 'Histogram', sample: '0-10, 4\n10-20, 9\n20-30, 14\n30-40, 8\n40-50, 3', help: 'Grouped data "10-20, 9" per line, or paste raw numbers and set a class width.' },
  { id: 'polygon', label: 'Frequency polygon', sample: '0-10, 4\n10-20, 9\n20-30, 14\n30-40, 8\n40-50, 3', help: 'Same input as the histogram.' },
  { id: 'ogive', label: 'Cumulative frequency (ogive)', sample: '0-10, 4\n10-20, 9\n20-30, 14\n30-40, 8\n40-50, 3', help: 'Grouped data. Median and quartiles are read off for you.' },
  { id: 'scatter', label: 'Scatter graph', sample: '1, 3\n2, 5\n3, 6\n4, 9\n5, 10\n6, 13', help: 'One "x, y" per line. A line of best fit is added.' },
  { id: 'box', label: 'Box-and-whisker', sample: '12 15 15 18 21 22 25 25 25 28 30 31 35 38 40', help: 'Raw numbers separated by spaces or commas.' },
];

export function ChartPanel({ ctx }: { ctx: PanelCtx }) {
  const s = useStore();
  const page = s.page;
  const chart = page.chart;
  const built = chartFor(page);
  const set = (c: ChartConfig | null, fit = false) => {
    s.update((p) => ({ ...p, chart: c, ...(c && p.paper.kind !== 'cartesian' && p.paper.kind !== 'millimetre' ? { paper: { ...p.paper, kind: 'cartesian' as PaperKind } } : {}) }), 'chart');
    if (fit) setTimeout(() => ctx.stage.current?.fit(), 0);
  };
  const start = (kind: ChartKind) => {
    const k = KINDS.find((x) => x.id === kind)!;
    set({ kind, title: '', xLabel: '', yLabel: '', data: k.sample, binWidth: 0 }, true);
  };
  const raw = chart && ['histogram', 'polygon', 'ogive', 'box'].includes(chart.kind) ? chart.data : '';
  const summary = built?.summary ?? (raw ? summarize(raw.split(/[\s,;]+/).map(Number).filter(Number.isFinite)) : null);
  const info = KINDS.find((k) => k.id === chart?.kind);

  return (
    <div className="panel-body">
      <Section title="Statistical chart" hint="Charts are drawn on real graph paper, so you can annotate, zoom and export them.">
        <div className="list">
          {KINDS.map((k) => <button key={k.id} className={`list-btn ${chart?.kind === k.id ? 'on' : ''}`} onClick={() => (chart?.kind === k.id ? set(chart, true) : start(k.id))}>{k.label}</button>)}
        </div>
      </Section>
      {chart && info && (
        <Section title="Data">
          <p className="muted small">{info.help}</p>
          <textarea className="mono data-input" rows={7} value={chart.data} spellCheck={false} onChange={(e) => set({ ...chart, data: e.target.value })} aria-label="Chart data" />
          <div className="row gap">
            <label className="grow">Title<input value={chart.title} onChange={(e) => set({ ...chart, title: e.target.value })} /></label>
          </div>
          <div className="row gap">
            <label className="grow">x-axis label<input value={chart.xLabel} onChange={(e) => set({ ...chart, xLabel: e.target.value })} /></label>
            <label className="grow">y-axis label<input value={chart.yLabel} onChange={(e) => set({ ...chart, yLabel: e.target.value })} /></label>
          </div>
          {['histogram', 'polygon', 'ogive'].includes(chart.kind) && (
            <label className="row gap center-v">Class width (raw data)<input className="narrow" placeholder="auto" value={chart.binWidth || ''} onChange={(e) => set({ ...chart, binWidth: Math.max(0, num(e.target.value, 0)) })} /></label>
          )}
          {built?.error && <div className="err">{built.error}</div>}
          <div className="row gap">
            <button className="btn" onClick={() => ctx.stage.current?.fit()}>Fit to screen</button>
            <button className="btn" onClick={() => set({ ...chart, data: info.sample })}>Sample data</button>
            <button className="btn danger" onClick={() => set(null)}>Remove chart</button>
          </div>
        </Section>
      )}
      {summary && (
        <Section title="Summary statistics">
          <table className="data stats"><tbody>
            {([['Count', summary.n], ['Mean', summary.mean], ['Median', summary.median], ['Mode', summary.modes.length ? summary.modes.join(', ') : 'none'], ['Minimum', summary.min], ['Maximum', summary.max], ['Range', summary.range], ['Lower quartile Q1', summary.q1], ['Upper quartile Q3', summary.q3], ['Interquartile range', summary.iqr], ['Standard deviation', summary.sd]] as [string, number | string][]).map(([k, val]) => (
              <tr key={k}><th>{k}</th><td>{typeof val === 'number' ? formatNum(val, 0.001) : val}</td></tr>
            ))}
          </tbody></table>
        </Section>
      )}
      {built?.table && (
        <Section title="Table">
          <div className="table-wrap"><table className="data"><tbody>{built.table.map((r, i) => <tr key={i}>{r.map((c, j) => (i === 0 ? <th key={j}>{c}</th> : <td key={j}>{c}</td>))}</tr>)}</tbody></table></div>
        </Section>
      )}
    </div>
  );
}

// =========================================================================== PAPER
const PAPERS: { id: PaperKind; label: string }[] = [
  { id: 'cartesian', label: 'Graph paper' }, { id: 'millimetre', label: 'Millimetre' }, { id: 'polar', label: 'Polar' },
  { id: 'semilogy', label: 'Semi-log (y)' }, { id: 'semilogx', label: 'Semi-log (x)' }, { id: 'loglog', label: 'Log-log' },
  { id: 'isometric', label: 'Isometric' }, { id: 'dot', label: 'Dot grid' }, { id: 'blank', label: 'Blank' },
];
const TONES: { id: PaperTone; label: string; bg: string }[] = [
  { id: 'white', label: 'White', bg: '#fff' }, { id: 'cream', label: 'Cream', bg: '#fbf6e8' }, { id: 'blue', label: 'Blue', bg: '#f3f8ff' }, { id: 'board', label: 'Board', bg: '#13212f' },
];

export function PaperPanel({ ctx }: { ctx: PanelCtx }) {
  const s = useStore();
  const page = s.page;
  const { w, h } = ctx.stage.current?.size() ?? { w: 800, h: 600 };
  const vw = page.view;
  const win = { x0: vw.cx - w / (2 * vw.sx), x1: vw.cx + w / (2 * vw.sx), y0: vw.cy - h / (2 * vw.sy), y1: vw.cy + h / (2 * vw.sy) };
  const [draft, setDraft] = useState<Record<string, string>>({});
  const field = (k: keyof typeof win) => draft[k] ?? String(Number(win[k].toFixed(4)));
  const applyWindow = () => {
    const x0 = num(field('x0'), win.x0), x1 = num(field('x1'), win.x1), y0 = num(field('y0'), win.y0), y1 = num(field('y1'), win.y1);
    setDraft({});
    if (x1 > x0 && y1 > y0) s.setView({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, sx: w / (x1 - x0), sy: h / (y1 - y0) });
    else ctx.toast('The maximum must be bigger than the minimum.');
  };
  const log = isLogX(page.paper.kind) || isLogY(page.paper.kind);

  return (
    <div className="panel-body">
      <Section title="Paper">
        <div className="grid3">
          {PAPERS.map((p) => (
            <button key={p.id} className={`paper-btn ${page.paper.kind === p.id ? 'on' : ''}`} onClick={() => {
              s.update((pg) => ({ ...pg, paper: { ...pg.paper, kind: p.id }, ...(p.id.startsWith('log') || p.id.startsWith('semilog') ? { view: { cx: 1, cy: 1, sx: 90, sy: 90 } } : isLogX(pg.paper.kind) || isLogY(pg.paper.kind) ? { view: { cx: 0, cy: 0, sx: 40, sy: 40 } } : {}) }));
              ctx.setOpts({ ...ctx.opts, lockAspect: !(p.id.startsWith('log') || p.id.startsWith('semilog')) });
            }}>{p.label}</button>
          ))}
        </div>
        <div className="row gap center-v wrap">
          {TONES.map((t) => <button key={t.id} className={`tone ${page.paper.tone === t.id ? 'on' : ''}`} style={{ background: t.bg }} title={t.label} aria-label={`${t.label} paper`} aria-pressed={page.paper.tone === t.id} onClick={() => s.update((p) => ({ ...p, paper: { ...p.paper, tone: t.id } }))} />)}
        </div>
        <label className="check"><input type="checkbox" checked={page.paper.axes} onChange={(e) => s.update((p) => ({ ...p, paper: { ...p.paper, axes: e.target.checked } }))} /> Show axes</label>
        <label className="check"><input type="checkbox" checked={page.paper.numbers} onChange={(e) => s.update((p) => ({ ...p, paper: { ...p.paper, numbers: e.target.checked } }))} /> Show numbers</label>
        <label className="check"><input type="checkbox" checked={ctx.opts.snap && !log} disabled={log} onChange={(e) => ctx.setOpts({ ...ctx.opts, snap: e.target.checked })} /> Snap to grid</label>
        <label className="check"><input type="checkbox" checked={ctx.opts.lockAspect} onChange={(e) => ctx.setOpts({ ...ctx.opts, lockAspect: e.target.checked })} /> Keep x and y scales equal when zooming</label>
      </Section>
      <Section title="Window" hint={log ? 'On logarithmic paper these are powers of 10 (0 = 1, 1 = 10, 2 = 100).' : 'Set the exact part of the plane you want to see.'}>
        <div className="grid2">
          {(['x0', 'x1', 'y0', 'y1'] as const).map((k) => (
            <label key={k}>{k === 'x0' ? 'x min' : k === 'x1' ? 'x max' : k === 'y0' ? 'y min' : 'y max'}
              <input value={field(k)} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} onBlur={() => Object.keys(draft).length && applyWindow()} onKeyDown={(e) => e.key === 'Enter' && applyWindow()} />
            </label>
          ))}
        </div>
        <div className="row gap">
          <button className="btn" onClick={() => { const m = Math.min(vw.sx, vw.sy); s.setView({ ...vw, sx: m, sy: m }); }}>Equal axes</button>
          <button className="btn" onClick={() => ctx.stage.current?.fit()}>Reset view</button>
        </div>
      </Section>
    </div>
  );
}

// =========================================================================== PAGES
export function PagesPanel({ ctx }: { ctx: PanelCtx }) {
  const s = useStore();
  return (
    <div className="panel-body">
      <Section title="Pages" hint="Use pages as slides: one idea per page, then present.">
        <button className="btn primary" onClick={ctx.present}>▶ Present</button>
        {s.doc.pages.map((p, i) => (
          <div key={p.id} className={`page-row ${i === s.pageIndex ? 'on' : ''}`}>
            <button className="page-no" onClick={() => s.setPageIndex(i)} aria-label={`Go to page ${i + 1}`}>{i + 1}</button>
            <input className="grow" value={p.name} onFocus={() => s.setPageIndex(i)} onChange={(e) => s.updateDoc((d) => ({ ...d, pages: d.pages.map((q) => (q.id === p.id ? { ...q, name: e.target.value } : q)) }), `pn:${p.id}`)} aria-label={`Name of page ${i + 1}`} />
            <button className="icon" title="Move up" disabled={i === 0} onClick={() => s.movePage(i, -1)}>↑</button>
            <button className="icon" title="Move down" disabled={i === s.doc.pages.length - 1} onClick={() => s.movePage(i, 1)}>↓</button>
            <button className="icon" title="Delete page" disabled={s.doc.pages.length < 2} onClick={() => confirm(`Delete "${p.name}"?`) && s.removePage(i)}>✕</button>
          </div>
        ))}
        <div className="row gap">
          <button className="btn" onClick={() => s.addPage(false)}>＋ New page</button>
          <button className="btn" onClick={() => s.addPage(true)}>⧉ Duplicate page</button>
        </div>
      </Section>
    </div>
  );
}

// =========================================================================== EXPORT
export function ExportPanel({ ctx }: { ctx: PanelCtx }) {
  const s = useStore();
  const [scale, setScale] = useState(2);
  const [withInstruments, setWithInstruments] = useState(true);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const size = () => ctx.stage.current?.size() ?? { w: 1000, h: 700 };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e) { ctx.toast(e instanceof Error ? e.message : 'Export failed'); } finally { setBusy(false); }
  };
  return (
    <div className="panel-body">
      <Section title="Export drawing" hint="Exports exactly what you see on the paper.">
        <label className="row gap center-v">Quality
          <select value={scale} onChange={(e) => setScale(Number(e.target.value))}>
            <option value={1}>Screen (1×)</option><option value={2}>High (2×)</option><option value={3}>Print (3×)</option>
          </select>
        </label>
        <label className="check"><input type="checkbox" checked={withInstruments} onChange={(e) => setWithInstruments(e.target.checked)} /> Include ruler, protractor &amp; set squares</label>
        <div className="grid2">
          <button className="btn" disabled={busy} onClick={() => run(() => exportImage(s.page, size(), { type: 'png', scale, instruments: withInstruments, filename: `${s.title}-${s.page.name}` }))}>⬇ PNG image</button>
          <button className="btn" disabled={busy} onClick={() => run(() => exportImage(s.page, size(), { type: 'jpeg', scale, instruments: withInstruments, filename: `${s.title}-${s.page.name}` }))}>⬇ JPEG image</button>
          <button className="btn" disabled={busy} onClick={() => run(() => exportPDF([s.page], size(), { title: s.title, scale, instruments: withInstruments, orientation: 'auto', footer: true }))}>⬇ PDF — this page</button>
          <button className="btn" disabled={busy || s.doc.pages.length < 2} onClick={() => run(() => exportPDF(s.doc.pages, size(), { title: s.title, scale, instruments: withInstruments, orientation: 'auto', footer: true }))}>⬇ PDF — all pages</button>
        </div>
      </Section>
      <Section title="Save to this device" hint="Your drawing is also kept in this browser automatically.">
        <div className="grid2">
          <button className="btn" onClick={() => exportJSON(s.doc, s.title)}>Save file</button>
          <button className="btn" onClick={() => file.current?.click()}>Open file…</button>
        </div>
        <input ref={file} type="file" accept=".json,application/json" hidden onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try { const { doc, title } = parseDocFile(await f.text()); s.load(doc, title, null); ctx.toast('Drawing opened'); }
          catch (err) { ctx.toast(err instanceof Error ? err.message : 'Could not open that file'); }
        }} />
      </Section>
    </div>
  );
}
