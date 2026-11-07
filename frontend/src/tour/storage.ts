// Remembers (in this browser only) that the tour has been seen, so it is offered once and never nags.
const KEY = 'tmpgs:tour:v1';

export function tourSeen(): boolean {
  try { return localStorage.getItem(KEY) !== null; } catch { return true; } // can't remember → don't auto-start every visit
}
export function markTourSeen(how: 'finished' | 'skipped'): void {
  try { localStorage.setItem(KEY, how); } catch { /* private mode: fine */ }
}
export function resetTourSeen(): void {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
