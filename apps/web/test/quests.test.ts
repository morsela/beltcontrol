import { describe, it, expect } from 'vitest';
import { questsFor, type Quest } from '../src/lib/quests.js';
import { trustFor } from '../src/state/telemetry.js';
import type { DayTotal, Session } from '../src/state/session.js';

function walk(at: string, minutes = 10): Session {
  const startedAt = new Date(at).getTime();
  return {
    id: `s-${startedAt}-${minutes}`,
    startedAt,
    endedAt: startedAt + minutes * 60_000,
    activeMs: minutes * 60_000,
    distKm: 0,
    steps: 0,
    kcal: 0,
    protocol: 'classic',
    protocolName: 'Classic',
    deviceName: null,
    trust: trustFor('classic'),
    samples: [],
  };
}

const day = (minutes: number): DayTotal => ({
  key: '2026-06-09',
  date: new Date('2026-06-09T00:00').getTime(),
  minutes,
  distKm: 0,
  steps: 0,
  kcal: 0,
  excluded: 0,
});

const byId = (qs: Quest[], id: Quest['id']) => qs.find((q) => q.id === id)!;

describe('questsFor', () => {
  it('offers exactly three, in the order they tend to happen', () => {
    const qs = questsFor([], day(0), 60);
    expect(qs.map((q) => q.id)).toEqual(['morning', 'one-walk', 'goal']);
  });

  it('ticks nothing on an empty day', () => {
    expect(questsFor([], day(0), 60).every((q) => !q.done)).toBe(true);
  });

  it('ticks the morning walk before 9 AM and not at 9', () => {
    expect(byId(questsFor([walk('2026-06-09T08:59')], day(10), 60), 'morning').done).toBe(true);
    expect(byId(questsFor([walk('2026-06-09T09:00')], day(10), 60), 'morning').done).toBe(false);
  });

  it('measures the single walk by the longest, not the total', () => {
    // Otherwise it is the goal meter again, in a shorter unit.
    const three = [
      walk('2026-06-09T09:00', 6),
      walk('2026-06-09T11:00', 6),
      walk('2026-06-09T14:00', 6),
    ];
    expect(byId(questsFor(three, day(18), 60), 'one-walk').done).toBe(false);
    expect(byId(questsFor([walk('2026-06-09T09:00', 15)], day(15), 60), 'one-walk').done).toBe(
      true
    );
  });

  it('shows progress part-way through a walk and never at zero', () => {
    // "0 of 15" before anything has happened is the phrasing fmtGoalProgress was
    // rewritten to stop using.
    expect(byId(questsFor([], day(0), 60), 'one-walk').progress).toBeNull();
    expect(byId(questsFor([walk('2026-06-09T09:00', 4)], day(4), 60), 'one-walk').progress).toBe(
      '4 of 15'
    );
  });

  it('drops progress once the walk is long enough', () => {
    const q = byId(questsFor([walk('2026-06-09T09:00', 20)], day(20), 60), 'one-walk');
    expect(q.done).toBe(true);
    expect(q.progress).toBeNull();
  });

  it('reads the goal from settings rather than hardcoding an hour', () => {
    const qs = questsFor([], day(0), 30);
    expect(byId(qs, 'goal').label).toBe('Hit the 30-minute goal');
    expect(byId(questsFor([], day(30), 30), 'goal').done).toBe(true);
  });

  it('counts the day totals it is handed, so it cannot disagree with the meter', () => {
    // The sessions say nothing about the goal; the folded day does.
    expect(byId(questsFor([], day(60), 60), 'goal').done).toBe(true);
  });

  it('treats a goal of zero as no goal rather than one already met', () => {
    expect(byId(questsFor([], day(0), 0), 'goal').done).toBe(false);
  });
});
