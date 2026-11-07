// Document store with undo/redo. All updates are immutable, so history is cheap (structural sharing).

import { useSyncExternalStore } from 'react';
import { newDoc, newPage, type Doc, type Page, type View } from './engine/types';

export interface BoardMeta {
  id: string;
  version: number;
  ownerId: string;
  visibility: 'private' | 'class' | 'submitted';
  classId: string | null;
  canWrite: boolean;
}

interface Snapshot {
  title: string;
  doc: Doc;
}

const LOCAL_KEY = 'tmpgs:autosave:v1';
const HISTORY_LIMIT = 150;

class DocStore {
  title = 'Untitled drawing';
  doc: Doc = newDoc();
  pageIndex = 0;
  board: BoardMeta | null = null; // set when this drawing is a cloud board
  rev = 0; // bumps on every content change
  savedRev = 0;
  private past: Snapshot[] = [];
  private future: Snapshot[] = [];
  private lastKey = '';
  private lastAt = 0;
  private listeners = new Set<() => void>();
  private version = 0;

  constructor() {
    try {
      const raw = localStorage.getItem(LOCAL_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s?.doc?.pages?.length) {
          this.doc = s.doc;
          this.title = s.title || this.title;
        }
      }
    } catch {
      /* ignore corrupt autosave */
    }
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getVersion = () => this.version;
  private emit() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  get page(): Page {
    return this.doc.pages[Math.min(this.pageIndex, this.doc.pages.length - 1)];
  }
  get dirty() {
    return this.rev !== this.savedRev;
  }
  markSaved() {
    this.savedRev = this.rev;
    this.emit();
  }
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }

  /** Immutable update of the current page. Updates with the same `key` within 900 ms share one undo step. */
  update(fn: (p: Page) => Page, key = '') {
    const i = Math.min(this.pageIndex, this.doc.pages.length - 1);
    const next = fn(this.doc.pages[i]);
    if (next === this.doc.pages[i]) return;
    this.commit({ title: this.title, doc: { ...this.doc, pages: this.doc.pages.map((p, k) => (k === i ? next : p)) } }, key);
  }

  updateDoc(fn: (d: Doc) => Doc, key = '') {
    this.commit({ title: this.title, doc: fn(this.doc) }, key);
  }

  setTitle(title: string) {
    if (title === this.title) return;
    this.commit({ title, doc: this.doc }, 'title');
  }

  private commit(next: Snapshot, key: string) {
    const now = Date.now();
    const merge = key && key === this.lastKey && now - this.lastAt < 900;
    if (!merge) {
      this.past.push({ title: this.title, doc: this.doc });
      if (this.past.length > HISTORY_LIMIT) this.past.shift();
    }
    this.future = [];
    this.lastKey = key;
    this.lastAt = now;
    this.title = next.title;
    this.doc = next.doc;
    this.rev++;
    this.emit();
    this.autosave();
  }

  /** Pan / zoom: not part of undo history and does not count as an edit. */
  setView(view: View) {
    const i = Math.min(this.pageIndex, this.doc.pages.length - 1);
    this.doc = { ...this.doc, pages: this.doc.pages.map((p, k) => (k === i ? { ...p, view } : p)) };
    this.emit();
  }

  setPageIndex(i: number) {
    this.pageIndex = Math.max(0, Math.min(i, this.doc.pages.length - 1));
    this.emit();
  }

  addPage(duplicate = false) {
    const base = this.page;
    const page: Page = duplicate
      ? { ...structuredClone(base), id: newPage().id, name: `${base.name} copy` }
      : newPage(`Page ${this.doc.pages.length + 1}`, base.paper.kind);
    if (!duplicate) page.paper = { ...base.paper };
    const at = this.pageIndex + 1;
    this.updateDoc((d) => ({ ...d, pages: [...d.pages.slice(0, at), page, ...d.pages.slice(at)] }));
    this.setPageIndex(at);
  }

  removePage(i: number) {
    if (this.doc.pages.length < 2) return;
    this.updateDoc((d) => ({ ...d, pages: d.pages.filter((_, k) => k !== i) }));
    this.setPageIndex(Math.min(this.pageIndex, this.doc.pages.length - 1));
  }

  movePage(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= this.doc.pages.length) return;
    this.updateDoc((d) => {
      const pages = [...d.pages];
      [pages[i], pages[j]] = [pages[j], pages[i]];
      return { ...d, pages };
    });
    this.setPageIndex(j);
  }

  undo() {
    const s = this.past.pop();
    if (!s) return;
    this.future.push({ title: this.title, doc: this.doc });
    this.title = s.title;
    this.doc = s.doc;
    this.lastKey = '';
    this.rev++;
    this.pageIndex = Math.min(this.pageIndex, this.doc.pages.length - 1);
    this.emit();
    this.autosave();
  }

  redo() {
    const s = this.future.pop();
    if (!s) return;
    this.past.push({ title: this.title, doc: this.doc });
    this.title = s.title;
    this.doc = s.doc;
    this.lastKey = '';
    this.rev++;
    this.pageIndex = Math.min(this.pageIndex, this.doc.pages.length - 1);
    this.emit();
    this.autosave();
  }

  /** Replace everything (open a board / file / new drawing). */
  load(doc: Doc, title: string, board: BoardMeta | null = null) {
    this.doc = doc;
    this.title = title;
    this.board = board;
    this.pageIndex = 0;
    this.past = [];
    this.future = [];
    this.lastKey = '';
    this.rev++;
    this.savedRev = this.rev;
    this.emit();
    this.autosave();
  }

  newDrawing() {
    this.load(newDoc(), 'Untitled drawing', null);
  }

  setBoard(b: BoardMeta | null) {
    this.board = b;
    this.emit();
  }

  private timer: ReturnType<typeof setTimeout> | undefined;
  private autosave() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      try {
        const payload = JSON.stringify({ title: this.title, doc: this.doc });
        if (payload.length < 4_000_000) localStorage.setItem(LOCAL_KEY, payload);
      } catch {
        /* storage full or disabled — cloud save and file export still work */
      }
    }, 1200);
  }
}

export const store = new DocStore();

/** Re-renders the component whenever the document changes. */
export function useStore() {
  useSyncExternalStore(store.subscribe, store.getVersion);
  return store;
}
