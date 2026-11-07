import { useCallback, useEffect, useRef, useState } from 'react';
import markUrl from './assets/tmp-mark.svg';
import { TMP_HOME_URL, api, ApiError } from './api';
import { useAuth } from './auth';
import { BoardsDialog } from './components/BoardsDialog';
import { CanvasStage, type StageHandle } from './components/CanvasStage';
import { ChartPanel, DrawPanel, ExportPanel, GraphPanel, PagesPanel, PaperPanel, type PanelCtx } from './components/Panels';
import { THEMES } from './engine/paper';
import { PALETTE, type Doc } from './engine/types';
import { store, useStore } from './store';
import { COLORS, TOOLS, defaultOpts, type ToolId, type ToolOpts } from './toolTypes';
import { CONSTRUCT_TOOLS } from './engine/constructions';

type Tab = 'graph' | 'draw' | 'chart' | 'paper' | 'pages' | 'export';
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'graph', label: 'Graph', icon: '𝑓' }, { id: 'draw', label: 'Draw', icon: '📐' }, { id: 'chart', label: 'Charts', icon: '📊' },
  { id: 'paper', label: 'Paper', icon: '▦' }, { id: 'pages', label: 'Pages', icon: '▤' }, { id: 'export', label: 'Export', icon: '⬇' },
];

const hasContent = (d: Doc) => d.pages.length > 1 || d.pages.some((p) => p.objects.length || p.equations.length || p.chart || p.instruments.length);

/** TMP monogram (traced from the official logo) + gold rule + two-line wordmark, as on the TMP site header. */
function Logo() {
  return (
    <span className="logo">
      <img className="logo-mark" src={markUrl} alt="TMP" width="64" height="38" />
      <i className="logo-rule" aria-hidden="true" />
      <span className="logo-word">The Modern<br />Pedagogues</span>
    </span>
  );
}

export default function App() {
  const s = useStore();
  const auth = useAuth();
  const stage = useRef<StageHandle>(null);
  const [tool, setTool] = useState<ToolId>('pen');
  const [opts, setOpts] = useState<ToolOpts>(defaultOpts);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [selInst, setSelInst] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('graph');
  const [sheet, setSheet] = useState(false); // mobile bottom sheet
  const [boards, setBoards] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [spotlight, setSpotlight] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; msg: string }[]>([]);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error' | 'conflict'>('idle');
  const toastId = useRef(0);

  const toast = useCallback((msg: string) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-2), { id, msg }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const page = s.page;
  const theme = THEMES[page.paper.tone];

  // ---- selection / style editing --------------------------------------------------------
  const setOptsAndSelection = (next: ToolOpts) => {
    setOpts(next);
    if (selection.size) {
      s.update((p) => ({
        ...p,
        objects: p.objects.map((o) => (selection.has(o.id) ? { ...o, style: { ...o.style, color: next.color, width: next.width, dash: next.dash } } : o)),
      }), 'style');
    }
  };

  // ---- cloud saving ---------------------------------------------------------------------
  const saveCloud = useCallback(async () => {
    const b = store.board;
    if (!auth.user || !b || !b.canWrite) return;
    setSaveState('saving');
    try {
      const saved = await api.saveBoard(b.id, store.title, store.doc, b.version);
      store.setBoard({ ...b, version: saved.version });
      store.markSaved();
      setSaveState('saved');
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) { setSaveState('conflict'); toast('This board was changed in another window. Reload it from “Your boards” before saving.'); }
      else { setSaveState('error'); toast(e instanceof Error ? e.message : 'Could not save'); }
    }
  }, [auth.user, toast]);

  useEffect(() => {
    if (!auth.user || !s.board?.canWrite || !s.dirty || saveState === 'conflict') return;
    const t = setTimeout(saveCloud, 3500);
    return () => clearTimeout(t);
  }, [auth.user, s.board, s.rev, s.dirty, saveCloud, saveState]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (store.board?.canWrite && store.dirty) { e.preventDefault(); } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const confirmReplace = () => !hasContent(store.doc) || confirm('Replace the drawing on screen? Anything not saved to the cloud or a file will be lost.');

  // ---- presentation mode ----------------------------------------------------------------
  const present = useCallback(() => {
    setPresenting(true);
    setSheet(false);
    document.documentElement.requestFullscreen?.().catch(() => { /* fullscreen is optional */ });
  }, []);
  const stopPresenting = useCallback(() => {
    setPresenting(false); setSpotlight(false);
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }, []);
  useEffect(() => {
    const fs = () => { if (!document.fullscreenElement) setPresenting(false); };
    document.addEventListener('fullscreenchange', fs);
    return () => document.removeEventListener('fullscreenchange', fs);
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      if (presenting && e.key === 'Escape') stopPresenting();
      if (e.key === 'PageDown' || (presenting && e.key === 'ArrowRight' && !selection.size)) store.setPageIndex(store.pageIndex + 1);
      if (e.key === 'PageUp' || (presenting && e.key === 'ArrowLeft' && !selection.size)) store.setPageIndex(store.pageIndex - 1);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [presenting, selection, stopPresenting]);

  const ctx: PanelCtx = { stage, opts, setOpts, tool, setTool, selInst, setSelInst, toast, present };
  const user = auth.user;
  const roleLabel = user ? { admin: 'Admin', tutor: 'Tutor', student: 'Student', viewer: 'Viewer' }[user.role] : '';
  const board = s.board;
  const construct = tool.startsWith('c:') ? CONSTRUCT_TOOLS.find((c) => c.id === tool.slice(2)) : null;

  return (
    <div className={`app ${presenting ? 'presenting' : ''}`} style={{ ['--paper' as string]: theme.bg }}>
      {/* ------------------------------------------------------------ header */}
      <header className="header">
        <a className="brand" href={TMP_HOME_URL} title="Back to The Modern Pedagogues"><Logo /><span className="studio-tag">Graphing Studio</span></a>
        <input className="title" value={s.title} onChange={(e) => s.setTitle(e.target.value)} aria-label="Drawing title" maxLength={120} />
        <div className="header-actions">
          <button className="icon-btn" onClick={() => s.undo()} disabled={!s.canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">↶</button>
          <button className="icon-btn" onClick={() => s.redo()} disabled={!s.canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">↷</button>
          <button className="btn ghost hide-sm" onClick={() => { if (confirmReplace()) { s.newDrawing(); setSelection(new Set()); setSaveState('idle'); } }}>New</button>
          {user && (
            <button className="btn ghost" onClick={() => setBoards(true)}>
              ☁ Boards{board?.canWrite ? <small className={`dot ${s.dirty ? 'warn' : 'ok'}`} title={s.dirty ? 'Unsaved changes' : 'All changes saved'} /> : null}
            </button>
          )}
          <button className="btn gold" onClick={present} aria-label="Present">▶<span className="hide-sm"> Present</span></button>
          {auth.loading ? null : user ? (
            <div className="user" title={user.email ?? user.name}>
              <span className="avatar" aria-hidden="true">{user.name.slice(0, 1).toUpperCase()}</span>
              <span className="who hide-sm">{user.name}<em className={`role ${user.role}`}>{roleLabel}</em></span>
              <button className="btn ghost" onClick={() => auth.signOut()}>Sign out</button>
            </div>
          ) : (
            <div className="user">
              {auth.devLogin && <><button className="btn ghost dev-btn" onClick={() => auth.devLogin?.('tutor')}>Dev: tutor</button><button className="btn ghost dev-btn" onClick={() => auth.devLogin?.('student')}>Dev: student</button></>}
              <button className="btn ghost" onClick={auth.signIn} title={auth.offline ? 'Server not reachable — you can keep drawing offline' : 'Use your TMP account to save boards and share with your class'}>Sign in<span className="hide-sm"> with TMP</span></button>
            </div>
          )}
        </div>
      </header>

      {board && !board.canWrite && (
        <div className="banner">You are viewing a shared board. Changes here are not saved.
          <button className="btn sm" onClick={async () => { try { const b = await api.duplicate(board.id); store.load(b.data, b.title, { id: b.id, version: b.version, ownerId: b.ownerId, visibility: b.visibility, classId: b.classId, canWrite: true }); toast('Your own copy is ready to edit'); } catch (e) { toast(e instanceof Error ? e.message : 'Could not copy'); } }}>Make my copy</button></div>
      )}

      <div className="body">
        {/* ---------------------------------------------------------- tool rail */}
        <nav className="rail" aria-label="Drawing tools">
          {(['nav', 'draw', 'shape', 'mark'] as const).map((g) => (
            <div className="rail-group" key={g}>
              {TOOLS.filter((t) => t.group === g).map((t) => (
                <button key={t.id} className={`tool ${tool === t.id ? 'on' : ''}`} title={t.label} aria-label={t.label} aria-pressed={tool === t.id} onClick={() => { setTool(t.id); setSelection(new Set()); }}><span aria-hidden="true">{t.icon}</span><i>{t.label}</i></button>
              ))}
            </div>
          ))}
        </nav>

        {/* ------------------------------------------------------------ stage */}
        <main className="center">
          <div className="stylebar" role="toolbar" aria-label="Pen style">
            <div className="colors">
              {COLORS.map((c) => (
                <button key={c} className={`color ${opts.color === c ? 'on' : ''}`} style={{ background: c === 'auto' ? `linear-gradient(135deg, ${theme.ink} 50%, ${theme.bg} 50%)` : c }} title={c === 'auto' ? 'Ink (adapts to paper)' : c} aria-label={c === 'auto' ? 'Ink' : c} aria-pressed={opts.color === c} onClick={() => setOptsAndSelection({ ...opts, color: c })} />
              ))}
            </div>
            <label className="sl">Thickness<input type="range" min="1" max="10" step="0.5" value={opts.width} onChange={(e) => setOptsAndSelection({ ...opts, width: parseFloat(e.target.value) })} aria-label="Line thickness" /></label>
            <div className="seg" role="group" aria-label="Line style">
              {(['solid', 'dashed', 'dotted'] as const).map((d) => <button key={d} className={opts.dash === d ? 'on' : ''} onClick={() => setOptsAndSelection({ ...opts, dash: d })} title={d}>{d === 'solid' ? '───' : d === 'dashed' ? '– – –' : '· · ·'}</button>)}
            </div>
            <label className="check sm-check"><input type="checkbox" checked={opts.fill} onChange={(e) => setOpts({ ...opts, fill: e.target.checked })} /> Fill</label>
            <label className="check sm-check"><input type="checkbox" checked={opts.snap} onChange={(e) => setOpts({ ...opts, snap: e.target.checked })} /> Snap</label>
            {construct && <span className="pill-hint">{construct.label}</span>}
          </div>

          <div className="stage-wrap">
            <CanvasStage tool={tool} opts={opts} selection={selection} setSelection={setSelection} selInst={selInst} setSelInst={setSelInst} spotlight={spotlight} toast={toast} handle={stage} />
            <div className="zoom" role="group" aria-label="Zoom">
              <button onClick={() => stage.current?.zoom(1.3)} aria-label="Zoom in" title="Zoom in (+)">＋</button>
              <button onClick={() => stage.current?.zoom(1 / 1.3)} aria-label="Zoom out" title="Zoom out (−)">－</button>
              <button onClick={() => stage.current?.fit()} aria-label="Reset view" title="Reset view">⌂</button>
            </div>
            {s.doc.pages.length > 1 && (
              <div className="pager" role="group" aria-label="Pages">
                <button onClick={() => s.setPageIndex(s.pageIndex - 1)} disabled={s.pageIndex === 0} aria-label="Previous page">‹</button>
                <span>{s.pageIndex + 1} / {s.doc.pages.length}</span>
                <button onClick={() => s.setPageIndex(s.pageIndex + 1)} disabled={s.pageIndex === s.doc.pages.length - 1} aria-label="Next page">›</button>
              </div>
            )}
            {presenting && (
              <div className="present-bar" role="toolbar" aria-label="Presentation tools">
                {(['pen', 'highlighter', 'eraser', 'select', 'pan', 'laser'] as ToolId[]).map((id) => {
                  const t = TOOLS.find((x) => x.id === id)!;
                  return <button key={id} className={tool === id ? 'on' : ''} title={t.label} aria-label={t.label} onClick={() => setTool(id)}>{t.icon}</button>;
                })}
                <button className={spotlight ? 'on' : ''} title="Spotlight" aria-label="Spotlight" aria-pressed={spotlight} onClick={() => setSpotlight((v) => !v)}>◐</button>
                <span className="sep" />
                {PALETTE.slice(0, 5).map((c) => <button key={c} className="color" style={{ background: c }} aria-label={c} onClick={() => setOpts({ ...opts, color: c, width: Math.max(opts.width, 3) })} />)}
                <span className="sep" />
                <button onClick={() => s.undo()} aria-label="Undo">↶</button>
                <button onClick={() => s.setPageIndex(s.pageIndex - 1)} disabled={s.pageIndex === 0} aria-label="Previous page">‹</button>
                <span className="count">{s.pageIndex + 1}/{s.doc.pages.length}</span>
                <button onClick={() => s.setPageIndex(s.pageIndex + 1)} disabled={s.pageIndex === s.doc.pages.length - 1} aria-label="Next page">›</button>
                <span className="sep" />
                <button onClick={stopPresenting} aria-label="Exit presentation">✕</button>
              </div>
            )}
          </div>
        </main>

        {/* -------------------------------------------------------- side panel */}
        <aside className={`side ${sheet ? 'open' : ''}`} aria-label="Panels">
          <div className="tabs" role="tablist">
            {TABS.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => { setTab(t.id); setSheet(true); }}><span aria-hidden="true">{t.icon}</span><i>{t.label}</i></button>)}
            <button className="sheet-toggle" onClick={() => setSheet((o) => !o)} aria-label={sheet ? 'Hide panel' : 'Show panel'}>{sheet ? '▾' : '▴'}</button>
          </div>
          {tab === 'graph' && <GraphPanel ctx={ctx} />}
          {tab === 'draw' && <DrawPanel ctx={ctx} />}
          {tab === 'chart' && <ChartPanel ctx={ctx} />}
          {tab === 'paper' && <PaperPanel ctx={ctx} />}
          {tab === 'pages' && <PagesPanel ctx={ctx} />}
          {tab === 'export' && <ExportPanel ctx={ctx} />}
        </aside>
      </div>

      {boards && user && <BoardsDialog user={user} onClose={() => setBoards(false)} toast={toast} confirmReplace={confirmReplace} />}
      <div className="toasts" role="status" aria-live="polite">{toasts.map((t) => <div key={t.id} className="toast">{t.msg}</div>)}</div>
      {auth.error && !user && <div className="toasts" style={{ top: 64, bottom: 'auto' }}><div className="toast">{auth.error}</div></div>}
    </div>
  );
}
