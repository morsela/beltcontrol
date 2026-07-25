// The tread strip's timing, kept out of the component so it can be tested without a
// renderer or a compositor.
//
// The strip is one animation authored at a fixed rate and re-timed by playback rate,
// rather than an animation restarted at a new duration on every frame. A treadmill
// reports speed once or twice a second and a restart on each report is visible as a
// stutter; a playback-rate change is not, because it re-times the cycle already in
// flight instead of beginning a new one.

import { MOVING_KMH } from '../state/telemetry.js';

/** One tread slat to the next, in CSS pixels. The component hands this to CSS as
 *  `--tread-pitch` and to the animation as the distance one cycle travels, so the
 *  gradient period and the translation can never drift apart. */
export const TREAD_PITCH_PX = 14;

/** The speed the animation is authored at: at `TREAD_REF_KMH` it runs at rate 1.0,
 *  which is `TREAD_PITCH_PX` every `TREAD_CYCLE_MS`. 5 km/h is a brisk desk pace and
 *  lands mid-range for every pad the app talks to. */
export const TREAD_REF_KMH = 5;

/** One slat's travel at rate 1.0 — 40 px/s, quick enough to read as motion and slow
 *  enough that the slats stay individually visible rather than blurring to a wash. */
export const TREAD_CYCLE_MS = 400;

/**
 * Ceiling on the playback rate. Not a display preference: a pad that reports a wild
 * speed (a misdecoded frame, a scaling the driver got wrong) would otherwise drive the
 * strip into a strobe. The app already refuses out-of-envelope speed *commands*; this
 * is the same caution applied to what it is told.
 */
export const TREAD_MAX_RATE = 2.5;

/**
 * Playback rate for a reported speed. Zero means hold still.
 *
 * Nothing here invents motion. `null` is a pad that has not reported a speed yet, not a
 * pad reporting zero, and both hold the strip still — the same distinction the rest of
 * the app draws between silence and a stopped belt. The floor is `MOVING_KMH` rather
 * than a number of its own so the strip moves exactly when `isMoving` is true: a
 * stationary belt under a moving strip, or the reverse, is the bug this shares a
 * constant to avoid.
 */
export function treadRate(speedKmh: number | null | undefined): number {
  if (speedKmh == null || !Number.isFinite(speedKmh)) return 0;
  if (speedKmh <= MOVING_KMH) return 0;
  return Math.min(speedKmh / TREAD_REF_KMH, TREAD_MAX_RATE);
}
