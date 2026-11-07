import { describe, expect, it } from 'vitest';
import { markTourSeen, resetTourSeen, tourSeen } from './storage';

// vitest runs in Node here, where localStorage does not exist — exactly like a browser that blocks storage.
describe('tour "seen" flag', () => {
  it('treats a browser that cannot store anything as a first visit', () => {
    resetTourSeen();
    expect(() => tourSeen()).not.toThrow();
    expect(tourSeen()).toBe(false);
  });
  it('still shows the tour only once per page load when storage is blocked', () => {
    resetTourSeen();
    markTourSeen('skipped');
    expect(tourSeen()).toBe(true);
    resetTourSeen();
    expect(tourSeen()).toBe(false);
  });
});
