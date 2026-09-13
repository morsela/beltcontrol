// The sticker sheet: six things worth noticing about a walking habit.
//
// Every one of them is decided from wall-clock time and counts, and nothing else. That
// is not a shortage of ideas — a distance badge and a calories badge were both drafted
// and both cut. The reason is the rule the rest of this app already runs on: a pad
// whose distance scale was never established sends a number that is not kilometres,
// and one that computes calories from distance at a flat rate is not measuring
// anything. Badges built on those would be unearnable on some pads and quietly wrong
// on others, and which pad you own is not an achievement.
//
// Duration, start time and the number of walks are measured here, by this app, from
// the clock. docs/design.md calls that the one total that is always honest. So every
// sticker below can be earned on every protocol the app speaks, including the ones
// that report nothing but movement.
//
// Badges are derived on every render rather than stored. There is no earned-at
// timestamp anywhere in the session record, and adding one would mean a migration for
// data that can already answer the question: the sessions are the evidence, and a
// sticker is just a reading of them. It also means an imported backup lights up the
// sheet it should have lit up, rather than starting the new browser at zero.

import type { Session } from '../state/session.js';
import { dayKey } from './format.js';

/** Every sticker in the book, in the order they are drawn. */
export type BadgeId =
  | 'early-bird'
  | 'night-owl'
  | 'long-haul'
  | 'double-day'
  | 'week-straight'
  | 'century';

export interface Badge {
  id: BadgeId;
  /** The name, as it appears under the sticker. */
  name: string;
  /** What earns it, in the second person, shown for one not yet earned. */
  how: string;
}

/** A walk starting before this hour is an early one. */
const EARLY_BEFORE_H = 7;
/** A walk starting at or after this hour is a late one. */
const LATE_FROM_H = 21;
/** One session this long, in minutes, is a long haul. */
const LONG_HAUL_MIN = 60;
/** Walks recorded for the last sticker on the sheet. */
const CENTURY = 100;
/** Consecutive goal-meeting days for the streak sticker. */
const WEEK = 7;

export const BADGES: readonly Badge[] = [
  { id: 'early-bird', name: 'Early Bird', how: 'Walk before 7 AM' },
  { id: 'night-owl', name: 'Night Owl', how: 'Walk after 9 PM' },
  { id: 'long-haul', name: 'Long Haul', how: 'One walk of an hour' },
  { id: 'double-day', name: 'Double Day', how: 'Two walks in one day' },
  { id: 'week-straight', name: 'Week Straight', how: 'Meet the goal seven days running' },
  { id: 'century', name: 'Century', how: 'Record a hundred walks' },
] as const;

export interface BadgeState extends Badge {
  earned: boolean;
}

/**
 * Which stickers the stored history has earned.
 *
 * `bestStreakDays` is passed in rather than recomputed here so this stays a pure
 * reading of the sessions handed to it — the streak is the session store's own
 * calculation and depends on the goal, which lives in settings.
 */
export function badgeStates(sessions: Session[], bestStreakDays: number): BadgeState[] {
  let early = false;
  let late = false;
  let longHaul = false;

  // Walks per calendar day, for Double Day. Local day keys, so a walk at 11 PM counts
  // against the day it felt like rather than the UTC one.
  const perDay = new Map<string, number>();

  for (const s of sessions) {
    const h = new Date(s.startedAt).getHours();
    if (h < EARLY_BEFORE_H) early = true;
    if (h >= LATE_FROM_H) late = true;
    if (s.activeMs >= LONG_HAUL_MIN * 60_000) longHaul = true;

    const key = dayKey(s.startedAt);
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }

  let doubleDay = false;
  for (const n of perDay.values()) {
    if (n >= 2) {
      doubleDay = true;
      break;
    }
  }

  const earned: Record<BadgeId, boolean> = {
    'early-bird': early,
    'night-owl': late,
    'long-haul': longHaul,
    'double-day': doubleDay,
    'week-straight': bestStreakDays >= WEEK,
    century: sessions.length >= CENTURY,
  };

  return BADGES.map((b) => ({ ...b, earned: earned[b.id] }));
}

/**
 * Stickers earned today — what the sessions card calls out under the day's walks.
 *
 * Derived rather than stored, like everything else here: the same reading is taken
 * twice, once over the whole history and once over the history with today left out,
 * and anything true in the first and false in the second became true today. No
 * earned-at timestamp is needed, which matters because there is nowhere honest to put
 * one — a session record has never carried a badge, and an imported backup would
 * arrive without them.
 *
 * `bestStreakDays` is passed to both readings unchanged, so the streak sticker can
 * never be reported as new. That is deliberate: this function is not handed
 * yesterday's streak and will not guess at one, and under-claiming a reward is the
 * safe direction. The sticker still appears on the sheet the moment it is earned.
 */
export function badgesEarnedToday(
  sessions: Session[],
  bestStreakDays: number,
  now: number = Date.now()
): BadgeState[] {
  const today = dayKey(now);
  const before = sessions.filter((s) => dayKey(s.startedAt) !== today);
  // Nothing can have been earned today if nothing happened today.
  if (before.length === sessions.length) return [];

  const after = badgeStates(sessions, bestStreakDays);
  const prior = badgeStates(before, bestStreakDays);
  return after.filter((b, i) => b.earned && !prior[i]!.earned);
}

/**
 * The first sticker not yet earned, which is what the sheet points at next.
 *
 * Null once every one of them is on the page — at which point the sheet says so
 * rather than pointing at nothing.
 */
export function nextBadge(states: BadgeState[]): BadgeState | null {
  return states.find((b) => !b.earned) ?? null;
}
