import { describe, it, expect } from 'vitest';
import { shouldPing, fmtFrameAge, PING_MIN_GAP_MS } from '../src/lib/pulse.js';

describe('shouldPing', () => {
  it('ticks on the first frame of a link', () => {
    expect(shouldPing(null, 1_000)).toBe(true);
  });

  it('ticks once the minimum gap has passed', () => {
    expect(shouldPing(1_000, 1_000 + PING_MIN_GAP_MS)).toBe(true);
    expect(shouldPing(1_000, 5_000)).toBe(true);
  });

  it('swallows a burst arriving faster than the eye can read', () => {
    // A pad reassembling fragments can deliver several frames in a few tens of
    // milliseconds; a ring restarted on each one is a flicker, not a heartbeat.
    expect(shouldPing(1_000, 1_040)).toBe(false);
    expect(shouldPing(1_000, 1_000 + PING_MIN_GAP_MS - 1)).toBe(false);
  });

  it('holds the visible rate at four a second even under a flood', () => {
    let last: number | null = null;
    let ticks = 0;
    for (let t = 0; t < 1_000; t += 10) {
      if (shouldPing(last, t)) {
        last = t;
        ticks++;
      }
    }
    expect(ticks).toBeLessThanOrEqual(5);
  });

  it('ticks when the clock has gone backwards rather than waiting it out', () => {
    // A system time change or an NTP correction must not stop the indicator: a frozen
    // ring is indistinguishable from a dead link, which is the one wrong answer here.
    expect(shouldPing(10_000, 4_000)).toBe(true);
  });

  it('keeps ticking through a clock jump, at every step', () => {
    let last: number | null = 10_000;
    for (const now of [9_000, 8_000, 8_050, 20_000]) {
      const ping = shouldPing(last, now);
      if (ping) last = now;
      expect(typeof ping).toBe('boolean');
    }
    // The jump back ticked, so the reference moved with it rather than stranding the
    // indicator until the clock caught up to 10 s again.
    expect(last).toBe(20_000);
  });
});

describe('fmtFrameAge', () => {
  it('keeps a decimal below a second, where a healthy link lives', () => {
    expect(fmtFrameAge(0)).toBe('0.0 s ago');
    expect(fmtFrameAge(420)).toBe('0.4 s ago');
    expect(fmtFrameAge(999)).toBe('1.0 s ago');
  });

  it('rounds to whole seconds past a second', () => {
    expect(fmtFrameAge(1_000)).toBe('1 s ago');
    expect(fmtFrameAge(8_400)).toBe('8 s ago');
    expect(fmtFrameAge(59_000)).toBe('59 s ago');
  });

  it('switches to minutes for a link that has been quiet a while', () => {
    expect(fmtFrameAge(60_000)).toBe('1 min ago');
    expect(fmtFrameAge(9 * 60_000)).toBe('9 min ago');
  });

  it('reads a frame stamped in the future as zero, not as a negative age', () => {
    expect(fmtFrameAge(-5_000)).toBe('0.0 s ago');
  });
});
