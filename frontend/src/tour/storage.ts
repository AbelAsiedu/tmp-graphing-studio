// Remembers (in this browser only) that the tour has been seen, so it is offered once and never nags.
const KEY = 'tmpgs:tour:v1';
let seenThisSession = false; // covers browsers that block storage (private mode, embedded views): shown once per page load

export function tourSeen(): boolean {
  if (seenThisSession) return true;
  try { return localStorage.getItem(KEY) !== null; } catch { return false; } // can't tell → treat as a first visit
}
export function markTourSeen(how: 'finished' | 'skipped'): void {
  seenThisSession = true;
  try { localStorage.setItem(KEY, how); } catch { /* storage blocked: the in-memory flag still applies */ }
}
export function resetTourSeen(): void {
  seenThisSession = false;
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
