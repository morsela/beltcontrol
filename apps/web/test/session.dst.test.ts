// Daylight saving, which the rest of the suite cannot see: it runs in whatever zone the
// machine is in, and CI is in UTC, where every day is 24 hours long. Its own file so the
// zone it pins does not leak — vitest gives each test file its own process environment.
process.env.TZ = 'America/New_York';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sessions, currentSession, dailySeries, streak, bestStreak, type Session } from '../src/state/session.js';
import { trustFor } from '../src/state/telemetry.js';

const walkOn = (month: number, day: number, minutes = 60): Session => {
  const startedAt = new Date(2026, month, day, 9).getTime();
  return {
    id: `s-${month}-${day}`,
    startedAt,
    endedAt: startedAt + minutes * 60_000,
    activeMs: minutes * 60_000,
    distKm: 1,
    steps: 0,
    kcal: 0,
    protocol: 'classic',
    protocolName: 'test',
    deviceName: 'test',
    trust: trustFor('classic'),
    samples: [],
  };
};

beforeEach(() => {
  vi.useFakeTimers();
  sessions.value = [];
  currentSession.value = null;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a series across the clocks going forward', () => {
  // 8 March 2026 is 23 hours long in New York.
  beforeEach(() => vi.setSystemTime(new Date(2026, 2, 10, 12)));

  it('is in the zone this file asked for', () => {
    const day = new Date(2026, 2, 9).getTime() - new Date(2026, 2, 8).getTime();
    expect(day).toBe(23 * 3600_000);
  });

  it('visits the short day rather than stepping over it', () => {
    expect(dailySeries(5).map((d) => d.key)).toEqual([
      '2026-03-06',
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
      '2026-03-10',
    ]);
  });

  it('keeps the walk taken on it', () => {
    sessions.value = [walkOn(2, 8)];
    const day = dailySeries(5).find((d) => d.key === '2026-03-08');
    expect(day?.minutes).toBe(60);
  });

  it('counts it in a streak that runs through it', () => {
    sessions.value = [5, 6, 7, 8, 9, 10].map((d) => walkOn(2, d));
    expect(streak(60)).toBe(6);
    expect(bestStreak(60)).toBe(6);
  });

  it('ends a streak there when the goal was missed that day', () => {
    sessions.value = [5, 6, 7, 9, 10].map((d) => walkOn(2, d));
    expect(streak(60)).toBe(2);
  });
});

describe('a series across the clocks going back', () => {
  // 1 November 2026 is 25 hours long in New York.
  it('visits every day once', () => {
    vi.setSystemTime(new Date(2026, 10, 3, 12));
    expect(dailySeries(4).map((d) => d.key)).toEqual([
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
      '2026-11-03',
    ]);
  });
});
