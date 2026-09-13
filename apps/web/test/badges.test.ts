import { describe, it, expect } from 'vitest';
import {
  BADGES,
  badgeStates,
  badgesEarnedToday,
  nextBadge,
  type BadgeId,
} from '../src/lib/badges.js';
import { trustFor } from '../src/state/telemetry.js';
import type { Session } from '../src/state/session.js';

/** A stored walk. `at` is a local time, because every badge here reads the clock. */
function walk(at: string, minutes = 10, over: Partial<Session> = {}): Session {
  const startedAt = new Date(at).getTime();
  return {
    id: `s-${startedAt}-${Math.random()}`,
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
    ...over,
  };
}

const earned = (states: ReturnType<typeof badgeStates>, id: BadgeId) =>
  states.find((b) => b.id === id)!.earned;

describe('badgeStates', () => {
  it('earns nothing from an empty history', () => {
    const states = badgeStates([], 0);
    expect(states).toHaveLength(BADGES.length);
    expect(states.every((b) => !b.earned)).toBe(true);
  });

  it('returns every badge, earned or not, in the sheet order', () => {
    const states = badgeStates([walk('2026-06-09T06:30')], 0);
    expect(states.map((b) => b.id)).toEqual(BADGES.map((b) => b.id));
  });

  it('earns Early Bird before 7 AM and not at 7', () => {
    expect(earned(badgeStates([walk('2026-06-09T06:59')], 0), 'early-bird')).toBe(true);
    expect(earned(badgeStates([walk('2026-06-09T07:00')], 0), 'early-bird')).toBe(false);
  });

  it('earns Night Owl from 9 PM and not before', () => {
    expect(earned(badgeStates([walk('2026-06-09T21:00')], 0), 'night-owl')).toBe(true);
    expect(earned(badgeStates([walk('2026-06-09T20:59')], 0), 'night-owl')).toBe(false);
  });

  it('earns Long Haul on one walk of an hour, never on an hour spread over several', () => {
    // The distinction the badge exists for: six ten-minute walks is a good day, not
    // a long one, and the goal meter already counts the sum.
    expect(earned(badgeStates([walk('2026-06-09T09:00', 60)], 0), 'long-haul')).toBe(true);
    const six = Array.from({ length: 6 }, (_, i) => walk(`2026-06-09T${9 + i}:00`, 10));
    expect(earned(badgeStates(six, 0), 'long-haul')).toBe(false);
  });

  it('earns Double Day on two walks in one local day, not two across midnight', () => {
    const same = [walk('2026-06-09T08:00'), walk('2026-06-09T18:00')];
    expect(earned(badgeStates(same, 0), 'double-day')).toBe(true);

    // 11 PM and 1 AM are two days to the walker and would be one to UTC in half the
    // world. dayKey is local for exactly this reason.
    const across = [walk('2026-06-09T23:00'), walk('2026-06-10T01:00')];
    expect(earned(badgeStates(across, 0), 'double-day')).toBe(false);
  });

  it('takes the streak it is handed rather than recomputing one', () => {
    expect(earned(badgeStates([], 6), 'week-straight')).toBe(false);
    expect(earned(badgeStates([], 7), 'week-straight')).toBe(true);
  });

  it('earns Century at a hundred walks', () => {
    const many = Array.from({ length: 99 }, () => walk('2026-06-09T09:00'));
    expect(earned(badgeStates(many, 0), 'century')).toBe(false);
    expect(earned(badgeStates([...many, walk('2026-06-09T09:00')], 0), 'century')).toBe(true);
  });

  it('never depends on a figure the pad might not report', () => {
    // A walk on a pad that reports no distance, no steps and no calories still earns
    // everything the clock can see. This is the whole reason the sheet is time-based.
    const blind = walk('2026-06-09T06:00', 60, {
      protocol: 'fitshow',
      trust: trustFor('fitshow'),
    });
    const states = badgeStates([blind], 0);
    expect(earned(states, 'early-bird')).toBe(true);
    expect(earned(states, 'long-haul')).toBe(true);
  });
});

describe('nextBadge', () => {
  it('points at the first one not yet earned', () => {
    const states = badgeStates([walk('2026-06-09T06:00')], 0);
    expect(nextBadge(states)?.id).toBe('night-owl');
  });

  it('points at nothing once the sheet is full', () => {
    const states = BADGES.map((b) => ({ ...b, earned: true }));
    expect(nextBadge(states)).toBeNull();
  });
});

describe('badgesEarnedToday', () => {
  // A fixed "now" so the test does not depend on the hour it runs at.
  const NOW = new Date('2026-06-10T12:00').getTime();
  const today = (h: number, minutes = 10) => walk(`2026-06-10T${String(h).padStart(2, '0')}:00`, minutes);
  const earlier = (d: string, h: number, minutes = 10) =>
    walk(`${d}T${String(h).padStart(2, '0')}:00`, minutes);

  it('is empty when nothing happened today', () => {
    expect(badgesEarnedToday([earlier('2026-06-09', 6)], 0, NOW)).toEqual([]);
  });

  it('is empty when today earned nothing new', () => {
    // Early Bird was already on the sheet yesterday; walking early again adds nothing.
    const all = [earlier('2026-06-09', 6), today(6)];
    expect(badgesEarnedToday(all, 0, NOW)).toEqual([]);
  });

  it('names a sticker today earned for the first time', () => {
    const all = [earlier('2026-06-09', 12), today(6)];
    expect(badgesEarnedToday(all, 0, NOW).map((b) => b.id)).toEqual(['early-bird']);
  });

  it('names more than one when a day earns more than one', () => {
    const all = [earlier('2026-06-09', 12), today(6, 60), today(22)];
    expect(badgesEarnedToday(all, 0, NOW).map((b) => b.id)).toEqual([
      'early-bird',
      'night-owl',
      'long-haul',
      'double-day',
    ]);
  });

  it('never reports the streak sticker as new, even when it is', () => {
    // It has no yesterday-streak to compare against, so it declines to guess rather
    // than claiming a reward it cannot place on a day. The sheet still shows it.
    const all = [earlier('2026-06-09', 12), today(12)];
    expect(badgesEarnedToday(all, 7, NOW).map((b) => b.id)).toEqual([]);
    expect(badgeStates(all, 7).find((b) => b.id === 'week-straight')!.earned).toBe(true);
  });
});
