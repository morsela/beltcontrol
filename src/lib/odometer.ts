// The odometer's two decisions, kept out of the component so both are testable: what
// number it should be counting, and how that number breaks into rolling wheels.

import { toMiles } from './format.js';
import type { LifetimeTotals } from '../state/session.js';

export type OdometerCell =
  | { kind: 'digit'; value: number }
  | { kind: 'fixed'; char: string };

/**
 * One cell per character, digits marked as wheels and everything else — the group
 * separator, the decimal mark, a minus — left fixed.
 *
 * Driven off the already-formatted string rather than off the number, because the
 * separator and the decimal mark are `toLocaleString`'s business and vary by locale.
 * Anything that is not an ASCII digit is a fixed cell, so a locale that groups with a
 * space, an apostrophe or a non-breaking space is handled without knowing that it does.
 */
export function odometerCells(text: string): OdometerCell[] {
  const out: OdometerCell[] = [];
  for (const char of text) {
    if (char >= '0' && char <= '9') out.push({ kind: 'digit', value: Number(char) });
    else out.push({ kind: 'fixed', char });
  }
  return out;
}

export interface Headline {
  value: number;
  /** `mi` for a distance the protocols reported in real units; `h` when none did. */
  unit: 'mi' | 'h';
  /** True when the app has no distance it can vouch for and is counting time instead. */
  fellBack: boolean;
}

/**
 * What the odometer should count.
 *
 * Miles, when any stored session came from a protocol that reports distance in real
 * units. Hours otherwise — and that fallback is the point rather than a nicety. A
 * history made entirely of `0x1234` walks has no distance the app can place on a
 * scale, and a lifetime odometer reading `0.0 mi` over hundreds of walks would be the
 * exact failure [Field trust](../../docs/design.md#field-trust) exists to prevent.
 * Time is measured here, from the wall clock, and needs no cooperation from any pad,
 * so it is the one total that is always honest.
 */
export function lifetimeHeadline(t: LifetimeTotals): Headline {
  if (t.distKm > 0) return { value: toMiles(t.distKm), unit: 'mi', fellBack: false };
  return { value: t.minutes / 60, unit: 'h', fellBack: t.excluded > 0 };
}

/** One decimal, grouped for the locale — the string the wheels are built from. */
export const fmtOdometer = (value: number): string =>
  value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
