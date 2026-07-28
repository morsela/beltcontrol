import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Counter, sessions, currentSession, todayTotals, lifetimeTotals, dailySeries, streak, sessionsOn, deleteSession, exportCsv, csvField, holdSession, setSessionMeta, startSessionTracking, stopSessionTracking, type Session } from '../src/state/session.js';
import { live, EMPTY, trustFor } from '../src/state/telemetry.js';
import type { DriverId } from '../src/lib/drivers.js';
import { dayKey } from '../src/lib/format.js';

describe('Counter', () => {
  it('treats the first observation as a baseline, not a delta', () => {
    const c = new Counter();
    c.observe(5_000); // pad has been on all day; we joined late
    expect(c.total).toBe(0);
    c.observe(5_010);
    expect(c.total).toBe(10);
  });

  it('accumulates monotonic readings', () => {
    const c = new Counter();
    for (const v of [0, 10, 25, 40]) c.observe(v);
    expect(c.total).toBe(40);
  });

  it('rebases on a reset instead of subtracting a negative delta', () => {
    // The pads reset cumulative counters without warning. Naive differencing
    // yields a negative delta that silently corrupts every total downstream.
    const c = new Counter();
    c.observe(100);
    c.observe(150); // +50
    c.observe(0); // power cycle
    c.observe(20); // +20 from the new baseline
    expect(c.total).toBe(70);
  });

  it('never goes backwards, whatever the pad reports', () => {
    const c = new Counter();
    let prev = 0;
    for (const v of [10, 40, 5, 9, 2, 100, 3]) {
      c.observe(v);
      expect(c.total).toBeGreaterThanOrEqual(prev);
      prev = c.total;
    }
  });

  it('ignores absent and non-finite readings', () => {
    const c = new Counter();
    c.observe(10);
    c.observe(null);
    c.observe(undefined);
    c.observe(NaN);
    c.observe(Infinity);
    c.observe(30);
    expect(c.total).toBe(20);
  });

  it('resumes from a seeded total after a reload', () => {
    const c = new Counter();
    c.seed(3.5);
    c.observe(10);
    c.observe(12);
    expect(c.total).toBe(5.5);
  });
});

// --- aggregates -----------------------------------------------------------

const HOUR = 3_600_000;

/**
 * Stated outright rather than borrowed from a protocol that happens to carry an
 * unverified distance today. What these tests check is the exclusion mechanism, and
 * the trust table moves as captures settle scaling — as the 0x1234 distance did.
 */
const UNVERIFIED_DIST = { distKm: 'unverified', steps: 'ok', kcal: 'absent' } as const;

function session(over: Partial<Session> & { protocol: DriverId }): Session {
  const startedAt = over.startedAt ?? Date.now() - HOUR;
  return {
    id: Math.random().toString(36).slice(2),
    startedAt,
    endedAt: startedAt + 1_800_000,
    activeMs: 30 * 60_000,
    distKm: 2,
    steps: 3_000,
    kcal: 120,
    protocolName: over.protocol,
    deviceName: 'WalkingPad',
    trust: trustFor(over.protocol),
    samples: [],
    ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 5, 9, 14, 0, 0)); // Tue 9 Jun 2026, 14:00 local
  sessions.value = [];
  currentSession.value = null;
});

afterEach(() => {
  vi.useRealTimers();
  sessions.value = [];
  currentSession.value = null;
  localStorage.clear();
});

describe('todayTotals', () => {
  it('is all zeroes with no history', () => {
    expect(todayTotals.value).toMatchObject({ minutes: 0, distKm: 0, steps: 0, excluded: 0 });
  });

  it('sums today’s sessions and ignores other days', () => {
    sessions.value = [
      session({ protocol: 'classic', startedAt: Date.now() - HOUR }),
      session({ protocol: 'classic', startedAt: Date.now() - 2 * HOUR }),
      session({ protocol: 'classic', startedAt: Date.now() - 26 * HOUR }), // yesterday
    ];
    expect(todayTotals.value.minutes).toBe(60);
    expect(todayTotals.value.distKm).toBe(4);
  });

  it('includes the walk still in progress', () => {
    currentSession.value = session({ protocol: 'classic', activeMs: 10 * 60_000, distKm: 0.8 });
    expect(todayTotals.value.minutes).toBe(10);
    expect(todayTotals.value.distKm).toBeCloseTo(0.8, 6);
  });

  it('excludes unverified distance from the total and says how many it dropped', () => {
    // A history screen that quietly sums unscaled numbers as if they were
    // kilometres is worse than no history at all.
    sessions.value = [
      session({ protocol: 'classic', distKm: 2 }),
      session({ protocol: 'classic', distKm: 999, trust: UNVERIFIED_DIST }),
    ];
    expect(todayTotals.value.distKm).toBe(2);
    expect(todayTotals.value.excluded).toBe(1);
  });

  it('still counts time and steps from a pad whose distance is unverified', () => {
    sessions.value = [
      session({ protocol: 'classic', activeMs: 20 * 60_000, steps: 2_500, trust: UNVERIFIED_DIST }),
    ];
    expect(todayTotals.value.minutes).toBe(20);
    expect(todayTotals.value.steps).toBe(2_500);
  });

  it('does not count steps from FTMS, which has none to give', () => {
    sessions.value = [session({ protocol: 'ftms', steps: 4_000, kcal: 90 })];
    expect(todayTotals.value.steps).toBe(0);
    expect(todayTotals.value.kcal).toBe(90);
  });
});

describe('lifetimeTotals', () => {
  const DAY = 24 * HOUR;

  it('is all zeroes and dateless with no history', () => {
    expect(lifetimeTotals.value).toEqual({
      minutes: 0,
      distKm: 0,
      walks: 0,
      days: 0,
      excluded: 0,
      since: null,
    });
  });

  it('spans everything stored, however old — no window', () => {
    // The one total on the History screen that is not clipped to 30 days.
    sessions.value = [
      session({ protocol: 'classic', startedAt: Date.now() - 400 * DAY }),
      session({ protocol: 'classic', startedAt: Date.now() - 40 * DAY }),
      session({ protocol: 'classic', startedAt: Date.now() - HOUR }),
    ];
    expect(lifetimeTotals.value.walks).toBe(3);
    expect(lifetimeTotals.value.minutes).toBe(90);
    expect(lifetimeTotals.value.distKm).toBe(6);
  });

  it('counts calendar days, not sessions', () => {
    sessions.value = [
      session({ protocol: 'classic', startedAt: Date.now() - HOUR }),
      session({ protocol: 'classic', startedAt: Date.now() - 2 * HOUR }), // same day
      session({ protocol: 'classic', startedAt: Date.now() - 3 * DAY }),
    ];
    expect(lifetimeTotals.value.walks).toBe(3);
    expect(lifetimeTotals.value.days).toBe(2);
  });

  it('includes the walk in progress, so the odometer moves while you are on the belt', () => {
    sessions.value = [session({ protocol: 'classic', distKm: 2, activeMs: 30 * 60_000 })];
    currentSession.value = session({ protocol: 'classic', distKm: 0.5, activeMs: 6 * 60_000 });
    expect(lifetimeTotals.value.walks).toBe(2);
    expect(lifetimeTotals.value.distKm).toBeCloseTo(2.5, 6);
    expect(lifetimeTotals.value.minutes).toBe(36);
  });

  it('keeps an unverified distance out of the total and counts what it dropped', () => {
    sessions.value = [
      session({ protocol: 'classic', distKm: 2 }),
      session({ protocol: 'classic', distKm: 999, trust: UNVERIFIED_DIST }),
      session({ protocol: 'classic', distKm: 500, trust: UNVERIFIED_DIST }),
    ];
    expect(lifetimeTotals.value.distKm).toBe(2);
    expect(lifetimeTotals.value.excluded).toBe(2);
    // Time is measured here rather than taken from the pad, so it is never excluded.
    expect(lifetimeTotals.value.minutes).toBe(90);
  });

  it('does not count a session that reported no distance as one it dropped', () => {
    // `excluded` means "there was a number and it could not be trusted", not "there
    // was no number" — the note on the screen would otherwise accuse a pad of
    // reporting something it never sent.
    sessions.value = [
      session({ protocol: 'classic', distKm: 0, trust: UNVERIFIED_DIST }),
      session({ protocol: 'fitshow', distKm: 0 }),
    ];
    expect(lifetimeTotals.value.excluded).toBe(0);
  });

  it('dates the record from the earliest session, whatever order they arrive in', () => {
    const oldest = Date.now() - 300 * DAY;
    sessions.value = [
      session({ protocol: 'classic', startedAt: Date.now() - HOUR }),
      session({ protocol: 'classic', startedAt: oldest }),
      session({ protocol: 'classic', startedAt: Date.now() - 10 * DAY }),
    ];
    expect(lifetimeTotals.value.since).toBe(oldest);
  });
});

describe('dailySeries', () => {
  it('returns the window oldest-first, with empty days as zeroes', () => {
    sessions.value = [session({ protocol: 'classic', startedAt: Date.now() - 3 * 24 * HOUR })];
    const series = dailySeries(7);
    expect(series).toHaveLength(7);
    expect(series[6]!.key).toBe(dayKey(Date.now()));
    expect(series[3]!.minutes).toBe(30);
    expect(series[0]!.minutes).toBe(0);
  });

  it('spans a month boundary without a gap', () => {
    vi.setSystemTime(new Date(2026, 6, 2, 9)); // 2 Jul
    const series = dailySeries(5);
    expect(series.map((d) => d.key)).toEqual([
      '2026-06-28',
      '2026-06-29',
      '2026-06-30',
      '2026-07-01',
      '2026-07-02',
    ]);
  });
});

describe('streak', () => {
  const daysAgo = (n: number, minutes: number) =>
    session({ protocol: 'classic', startedAt: Date.now() - n * 24 * HOUR, activeMs: minutes * 60_000 });

  it('counts consecutive days that met the goal', () => {
    sessions.value = [daysAgo(0, 35), daysAgo(1, 40), daysAgo(2, 31)];
    expect(streak(30)).toBe(3);
  });

  it('stops at the first day that missed it', () => {
    sessions.value = [daysAgo(0, 35), daysAgo(1, 10), daysAgo(2, 60)];
    expect(streak(30)).toBe(1);
  });

  it('does not break a live streak just because today is not done yet', () => {
    // At 08:00 you have not walked yet; yesterday's streak is still alive.
    sessions.value = [daysAgo(1, 40), daysAgo(2, 40)];
    expect(streak(30)).toBe(2);
  });

  it('is zero when yesterday was missed and today is empty', () => {
    sessions.value = [daysAgo(2, 40)];
    expect(streak(30)).toBe(0);
  });

  it('adds up several short walks in one day', () => {
    sessions.value = [daysAgo(0, 12), daysAgo(0, 12), daysAgo(0, 12)];
    expect(streak(30)).toBe(1);
  });
});

describe('sessionsOn', () => {
  it('returns that day’s sessions, newest first', () => {
    const a = session({ protocol: 'classic', startedAt: Date.now() - 5 * HOUR });
    const b = session({ protocol: 'classic', startedAt: Date.now() - HOUR });
    sessions.value = [a, b];
    expect(sessionsOn(dayKey(Date.now())).map((s) => s.id)).toEqual([b.id, a.id]);
  });

  it('is empty for a day with nothing on it', () => {
    expect(sessionsOn('2020-01-01')).toEqual([]);
  });
});

describe('pausing a walk', () => {
  const MINUTE = 60_000;
  const belt = (kmh: number) => {
    live.value = { ...live.value, speedKmh: kmh };
  };
  /** Walk long enough to clear the 30 s floor, so what follows is about the hold. */
  const walkAWhile = () => {
    belt(3);
    vi.advanceTimersByTime(45_000);
  };

  beforeEach(() => {
    setSessionMeta({ protocol: 'classic', protocolName: 'test', deviceName: 'test' });
    startSessionTracking();
  });

  afterEach(() => {
    stopSessionTracking();
    holdSession(false);
    live.value = { ...EMPTY };
  });

  it('closes an idle session when nothing is holding it', () => {
    walkAWhile();
    belt(0);
    vi.advanceTimersByTime(61_000);
    expect(currentSession.value).toBeNull();
    expect(sessions.value).toHaveLength(1);
  });

  it('holds the walk open past the idle timeout while paused', () => {
    walkAWhile();
    holdSession(true);
    belt(0);
    vi.advanceTimersByTime(5 * MINUTE);
    expect(currentSession.value).not.toBeNull();
    expect(sessions.value).toHaveLength(0);
  });

  it('keeps a pause and resume as one walk, not two', () => {
    walkAWhile();
    const id = currentSession.value!.id;

    holdSession(true);
    belt(0);
    vi.advanceTimersByTime(5 * MINUTE);
    holdSession(false); // resuming releases the hold, as doResume does
    belt(3);
    vi.advanceTimersByTime(30_000);

    expect(sessions.value).toHaveLength(0);
    expect(currentSession.value!.id).toBe(id);
    // Only moving time counts: 45 s before the pause, 30 s after, nothing in between,
    // less the tick that opened the session and so had no interval to bank.
    expect(currentSession.value!.activeMs).toBe(74_000);
  });

  it('files the walk once the hold lapses, rather than holding it forever', () => {
    walkAWhile();
    holdSession(true);
    belt(0);
    vi.advanceTimersByTime(16 * MINUTE);
    expect(currentSession.value).toBeNull();
    expect(sessions.value).toHaveLength(1);
    // The 15 idle minutes bank nothing — a held session is still a stopped belt.
    expect(sessions.value[0]!.activeMs).toBe(44_000);
  });

  it('lets the idle rule take over again once the hold is released', () => {
    walkAWhile();
    holdSession(true);
    belt(0);
    vi.advanceTimersByTime(5 * MINUTE);
    holdSession(false);
    vi.advanceTimersByTime(61_000);
    expect(currentSession.value).toBeNull();
    expect(sessions.value).toHaveLength(1);
  });
});

describe('deleteSession', () => {
  it('removes only the one asked for', () => {
    const a = session({ protocol: 'classic' });
    const b = session({ protocol: 'classic' });
    sessions.value = [a, b];
    deleteSession(a.id);
    expect(sessions.value.map((s) => s.id)).toEqual([b.id]);
  });
});

/** Counts fields the way a CSV reader would: commas inside quotes do not separate. */
function countCsvFields(row: string): number {
  let fields = 1;
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const c = row[i];
    if (c === '"') {
      if (inQuotes && row[i + 1] === '"') i++; // an escaped quote, not a delimiter
      else inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) fields++;
  }
  return fields;
}

describe('exportCsv', () => {
  it('carries the trust columns, so a raw number is never mistaken for a real one', () => {
    sessions.value = [
      session({ protocol: 'classic', distKm: 12.5, steps: 3_000, trust: UNVERIFIED_DIST }),
    ];
    const [header, row] = exportCsv().split('\n');
    expect(header).toContain('distance_trust');
    expect(row!.split(',')).toContain('unverified');
  });

  it('emits a header even with nothing to export', () => {
    expect(exportCsv().split('\n')).toHaveLength(1);
  });

  it('neutralises a device name a spreadsheet would run as a formula', () => {
    // Device names come off the air, and "Show all devices" connects to anything.
    sessions.value = [session({ protocol: 'classic', deviceName: "=cmd|' /C calc'!A0" })];
    const row = exportCsv().split('\n')[1]!;
    expect(row).toContain(`"'=cmd|' /C calc'!A0"`);
    // The cell no longer begins with = once unquoted, so it is text, not a formula.
    expect(row).not.toContain('"=cmd');
  });

  it('escapes an embedded quote the way CSV requires, not the way JSON does', () => {
    sessions.value = [session({ protocol: 'classic', deviceName: 'Pad "Pro"' })];
    const row = exportCsv().split('\n')[1]!;
    expect(row).toContain('"Pad ""Pro"""'); // doubled, not backslashed
    expect(row).not.toContain('\\"');
  });

  it('keeps the column count stable whatever the device is called', () => {
    const names = [
      'KS-C2',
      'Pad, the second',
      'Pad "Pro"',
      "=cmd|' /C calc'!A0",
      '+41 555',
      '-lead',
      '@here',
      'KS-C2,9999,9999,9999',
    ];
    for (const deviceName of names) {
      sessions.value = [session({ protocol: 'classic', deviceName })];
      const row = exportCsv().split('\n')[1]!;
      expect(countCsvFields(row)).toBe(10);
    }
  });

  it('quotes the device name so a comma in it cannot shift the columns', () => {
    sessions.value = [session({ protocol: 'classic', deviceName: 'Pad, the second' })];
    const row = exportCsv().split('\n')[1]!;
    expect(row).toContain('"Pad, the second"');
    expect(row.split('","')).toHaveLength(1);
  });
});

describe('csvField', () => {
  it('always quotes, so an empty field is still a field', () => {
    expect(csvField('')).toBe('""');
    expect(csvField(null)).toBe('""');
    expect(csvField(undefined)).toBe('""');
  });

  it('doubles quotes rather than backslashing them', () => {
    expect(csvField('a"b')).toBe('"a""b"');
  });

  it('prefixes the characters spreadsheets treat as formula starters', () => {
    expect(csvField('=1+1')).toBe(`"'=1+1"`);
    expect(csvField('+1')).toBe(`"'+1"`);
    expect(csvField('-1')).toBe(`"'-1"`);
    expect(csvField('@x')).toBe(`"'@x"`);
    expect(csvField('\tx')).toBe(`"'\tx"`);
  });

  it('leaves an ordinary name alone', () => {
    expect(csvField('KS-C2')).toBe('"KS-C2"');
    expect(csvField('Pad, the second')).toBe('"Pad, the second"');
  });
});
