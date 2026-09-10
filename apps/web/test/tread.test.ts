import { describe, it, expect } from 'vitest';
import { treadRate, TREAD_REF_KMH, TREAD_MAX_RATE } from '../src/lib/tread.js';
import { MOVING_KMH } from '../src/state/telemetry.js';

describe('treadRate', () => {
  it('holds still when the pad has reported nothing', () => {
    // The distinction the whole app is built on: silence is not a report of zero, but
    // neither is it licence to animate a belt nobody has said is moving.
    expect(treadRate(null)).toBe(0);
    expect(treadRate(undefined)).toBe(0);
  });

  it('holds still on a junk reading rather than running at NaN', () => {
    expect(treadRate(NaN)).toBe(0);
    // Non-finite is not "very fast", it is "no usable reading" — so it stops rather
    // than pinning to the ceiling the way a merely absurd finite number does.
    expect(treadRate(Infinity)).toBe(0);
    expect(treadRate(-3)).toBe(0);
  });

  it('holds still at and below the movement floor', () => {
    expect(treadRate(0)).toBe(0);
    expect(treadRate(MOVING_KMH)).toBe(0);
  });

  it('moves as soon as isMoving would be true, and not before', () => {
    // Same threshold, deliberately: a stationary belt under a moving strip and a
    // moving belt under a still one are the same bug.
    expect(treadRate(MOVING_KMH + 0.001)).toBeGreaterThan(0);
  });

  it('runs at rate 1.0 at the authored speed and scales linearly below it', () => {
    expect(treadRate(TREAD_REF_KMH)).toBeCloseTo(1);
    expect(treadRate(TREAD_REF_KMH / 2)).toBeCloseTo(0.5);
    expect(treadRate(TREAD_REF_KMH / 4)).toBeCloseTo(0.25);
  });

  it('caps a wild reading instead of strobing', () => {
    // A misdecoded frame reporting 900 km/h should not turn the strip into a flicker.
    expect(treadRate(900)).toBe(TREAD_MAX_RATE);
    expect(treadRate(TREAD_REF_KMH * TREAD_MAX_RATE * 2)).toBe(TREAD_MAX_RATE);
  });

  it('rises monotonically across the range a real pad reports', () => {
    let last = -1;
    for (let kmh = 0; kmh <= 12; kmh += 0.1) {
      const r = treadRate(kmh);
      expect(r).toBeGreaterThanOrEqual(last);
      last = r;
    }
  });
});
