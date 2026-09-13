// Three things to aim at today, and no points for hitting them.
//
// A score was the first version and the first thing cut. Every figure on every other
// screen in this app is one the treadmill actually sent or one the clock actually
// measured; an XP total is neither, and putting an invented number in the same column
// as the measured ones undoes the thing that makes the measured ones worth reading.
// A tick is the smallest mark that still says "that one is done", and it is the only
// mark here.
//
// Like the badges, all three are decided from wall-clock time, so they work on every
// protocol — including the ones that report nothing but whether the belt is moving.
// They reset at local midnight because they are read against the day the walker is
// having, not the one UTC is having.

import type { DayTotal, Session } from '../state/session.js';

/** A walk started before this hour counts as a morning walk. */
const MORNING_BEFORE_H = 9;
/** The length of the single-walk quest, in minutes. */
const ONE_WALK_MIN = 15;

export interface Quest {
  id: 'morning' | 'one-walk' | 'goal';
  /** The whole label, already carrying any number it needs. */
  label: string;
  done: boolean;
  /** "4 of 15", shown only while a quest is part-way and not yet done. */
  progress: string | null;
}

/**
 * Today's three, in the order they tend to happen.
 *
 * `sessionsToday` is the day's sessions, the one in progress included; `day` is the
 * same day's folded totals, so the goal quest reads the identical minutes the meter
 * above it does rather than re-adding them and disagreeing by a rounding.
 */
export function questsFor(sessionsToday: Session[], day: DayTotal, goalMinutes: number): Quest[] {
  const morning = sessionsToday.some((s) => new Date(s.startedAt).getHours() < MORNING_BEFORE_H);

  // The longest single walk today, in minutes. Longest rather than total: this quest
  // exists to be different from the goal meter under it, which already counts the sum.
  const longestMin = sessionsToday.reduce((max, s) => Math.max(max, s.activeMs / 60_000), 0);
  const oneWalk = longestMin >= ONE_WALK_MIN;

  const goalMet = goalMinutes > 0 && day.minutes >= goalMinutes;

  return [
    {
      id: 'morning',
      label: 'Walk before 9 AM',
      done: morning,
      progress: null,
    },
    {
      id: 'one-walk',
      label: `One walk of ${ONE_WALK_MIN} minutes`,
      done: oneWalk,
      // Silent at zero: "0 of 15" before the day has started is the phrasing
      // fmtGoalProgress was rewritten to stop using.
      progress:
        oneWalk || longestMin < 1 ? null : `${Math.floor(longestMin)} of ${ONE_WALK_MIN}`,
    },
    {
      id: 'goal',
      label: `Hit the ${Math.round(goalMinutes)}-minute goal`,
      done: goalMet,
      progress: null,
    },
  ];
}
