import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  KM_PER_MILE,
  toMph,
  toKmh,
  MPH_STEP,
  EM_DASH,
  fmtTime,
  fmtDuration,
  fmtGoalProgress,
  fmt,
  fmtInt,
  fmtMph,
  fmtMiles,
  toMiles,
  dayKey,
  startOfDay,
  fmtDayLabel,
} from '../src/lib/format.js';

afterEach(() => vi.useRealTimers());

describe('units', () => {
  it('round-trips mph and km/h', () => {
    expect(toKmh(toMph(4.8))).toBeCloseTo(4.8, 10);
  });

  it('converts using the exact statute mile', () => {
    expect(toMph(KM_PER_MILE)).toBeCloseTo(1, 10);
    expect(toKmh(3)).toBeCloseTo(4.828032, 6);
    expect(toMiles(KM_PER_MILE)).toBeCloseTo(1, 10);
    expect(toMiles(5)).toBeCloseTo(3.106856, 6);
  });

  it('keeps one press inside the 0.5 km/h safety limit', () => {
    // The steppers move in mph but the wire is metric; a press that exceeded
    // 0.5 km/h would be rejected by the pad.
    expect(toKmh(MPH_STEP)).toBeLessThan(0.5);
  });
});

describe('fmtTime', () => {
  it('renders hh:mm:ss', () => {
    expect(fmtTime(0)).toBe('00:00:00');
    expect(fmtTime(59)).toBe('00:00:59');
    expect(fmtTime(3661)).toBe('01:01:01');
    expect(fmtTime(86_399)).toBe('23:59:59');
  });

  it('does not wrap past a day', () => {
    expect(fmtTime(90_000)).toBe('25:00:00');
  });

  it('renders an em dash rather than a fabricated zero', () => {
    expect(fmtTime(null)).toBe(EM_DASH);
    expect(fmtTime(undefined)).toBe(EM_DASH);
  });
});

describe('fmtDuration', () => {
  it('drops to the coarsest useful unit', () => {
    expect(fmtDuration(48)).toBe('48s');
    expect(fmtDuration(1_080)).toBe('18m');
    expect(fmtDuration(5_040)).toBe('1h 24m');
  });

  it('zero-pads minutes only once hours are shown', () => {
    expect(fmtDuration(3_660)).toBe('1h 01m');
    expect(fmtDuration(300)).toBe('5m');
  });

  it('renders an em dash for null', () => {
    expect(fmtDuration(null)).toBe(EM_DASH);
  });
});

describe('fmtGoalProgress', () => {
  it('leads with what is left before the first walk', () => {
    expect(fmtGoalProgress(0, 45)).toBe('45m to go');
    expect(fmtGoalProgress(0, 90)).toBe('1h 30m to go');
  });

  it('trims the empty minutes off a whole hour', () => {
    // The default goal is exactly 60 minutes, so "1h 00m" is the first thing a
    // new install would otherwise show.
    expect(fmtGoalProgress(0, 60)).toBe('1h to go');
    expect(fmtGoalProgress(30, 120)).toBe('30m · 1h 30m to go');
  });

  it('counts a walk under a minute as not started', () => {
    // Rounding it would print "0m", which is the wording this replaced.
    expect(fmtGoalProgress(0.4, 45)).toBe('45m to go');
  });

  it('shows both halves mid-walk', () => {
    expect(fmtGoalProgress(18, 60)).toBe('18m · 42m to go');
    expect(fmtGoalProgress(65, 90)).toBe('1h 05m · 25m to go');
  });

  it('never says zero left while the goal is still short', () => {
    expect(fmtGoalProgress(59.7, 60)).toBe('59m · 1m to go');
  });

  it('drops the countdown once the goal is met', () => {
    expect(fmtGoalProgress(60, 60)).toBe('1h walked');
    expect(fmtGoalProgress(65, 60)).toBe('1h 05m walked');
  });

  it('has nothing to count down to without a goal', () => {
    expect(fmtGoalProgress(18, 0)).toBe('18m walked');
  });
});

describe('numeric formatters', () => {
  it('fmt honours digits and suffix', () => {
    expect(fmt(1.006, 2)).toBe('1.01');
    expect(fmt(3, 1, ' km')).toBe('3.0 km');
    expect(fmt(null, 2)).toBe(EM_DASH);
  });

  it('fmtInt rounds and groups', () => {
    expect(fmtInt(1234.6)).toBe((1235).toLocaleString());
    expect(fmtInt(null)).toBe(EM_DASH);
  });

  it('fmtMph converts on the way to the screen', () => {
    expect(fmtMph(4.828032)).toBe('3.0');
    expect(fmtMph(0)).toBe('0.0');
    expect(fmtMph(null)).toBe(EM_DASH);
  });

  it('fmtMiles converts distance the same way speed is converted', () => {
    // State stays metric like the wire; miles happen only at the screen.
    expect(fmtMiles(KM_PER_MILE)).toBe('1.00');
    expect(fmtMiles(6.3421)).toBe('3.94');
    expect(fmtMiles(0)).toBe('0.00');
    expect(fmtMiles(null)).toBe(EM_DASH);
  });

  it('fmtMiles honours a coarser precision for long totals', () => {
    expect(fmtMiles(48.28032, 1)).toBe('30.0');
  });
});

describe('day boundaries', () => {
  it('files a late-evening walk under the local day, not UTC tomorrow', () => {
    // 23:30 local. toISOString() would roll this into the next day for any
    // timezone east of UTC, splitting a single evening walk across two days.
    const late = new Date(2026, 2, 14, 23, 30, 0);
    expect(dayKey(late.getTime())).toBe('2026-03-14');
  });

  it('zero-pads month and day', () => {
    expect(dayKey(new Date(2026, 0, 5, 12).getTime())).toBe('2026-01-05');
  });

  it('startOfDay lands on local midnight', () => {
    const d = new Date(2026, 5, 9, 17, 42, 13, 500);
    const start = new Date(startOfDay(d.getTime()));
    expect([start.getHours(), start.getMinutes(), start.getSeconds(), start.getMilliseconds()]).toEqual([0, 0, 0, 0]);
    expect(start.getDate()).toBe(9);
  });

  it('is stable across a day for the same date', () => {
    const morning = new Date(2026, 5, 9, 6).getTime();
    const evening = new Date(2026, 5, 9, 22).getTime();
    expect(startOfDay(morning)).toBe(startOfDay(evening));
    expect(dayKey(morning)).toBe(dayKey(evening));
  });
});

describe('fmtDayLabel', () => {
  it('names the two most recent days', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 9, 12));
    expect(fmtDayLabel(new Date(2026, 5, 9, 8).getTime())).toBe('Today');
    expect(fmtDayLabel(new Date(2026, 5, 8, 21).getTime())).toBe('Yesterday');
    expect(fmtDayLabel(new Date(2026, 5, 7, 21).getTime())).not.toBe('Yesterday');
  });

  it('survives a DST shift, where the days are not 24 h apart', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 9, 12)); // day after US spring-forward
    expect(fmtDayLabel(new Date(2026, 2, 8, 12).getTime())).toBe('Yesterday');
  });
});
