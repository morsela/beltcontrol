import { signal, computed } from '@preact/signals';
import type { DriverId, Telemetry } from '../lib/drivers.js';

/**
 * How much to believe each numeric field, per protocol.
 *
 *   ok         the device reports this in real units
 *   unverified the device reports a number but its scaling was never established,
 *              so it is shown raw and excluded from every aggregate
 *   absent     the protocol carries no such field at all
 *
 * Sourced from the protocol notes in README.md: the 0x1234 family's RunningDistance
 * and BurnCalories scaling is not known, FTMS carries no step count, and the classic
 * frame has no calorie field.
 */
export type Trust = 'ok' | 'unverified' | 'absent';
export type TrustedField = 'distKm' | 'steps' | 'kcal';
export type TrustMap = Record<TrustedField, Trust>;

const TRUST: Record<DriverId, TrustMap> = {
  classic: { distKm: 'ok', steps: 'ok', kcal: 'absent' },
  ftms: { distKm: 'ok', steps: 'absent', kcal: 'ok' },
  ks1234: { distKm: 'unverified', steps: 'ok', kcal: 'unverified' },
  fitshow: { distKm: 'absent', steps: 'absent', kcal: 'absent' },
};

const UNKNOWN_TRUST: TrustMap = { distKm: 'absent', steps: 'absent', kcal: 'absent' };

export const trustFor = (id: DriverId | null): TrustMap =>
  id ? (TRUST[id] ?? UNKNOWN_TRUST) : UNKNOWN_TRUST;

export const EMPTY: Telemetry = {
  speedKmh: null,
  distKm: null,
  steps: null,
  secs: null,
  kcal: null,
  state: null,
  stateLabel: null,
  mode: null,
  heartRate: null,
  inclinePct: null,
};

/** Latest merged telemetry. */
export const live = signal<Telemetry>({ ...EMPTY });

/** Wall-clock ms of the most recent frame, for staleness detection. */
export const lastFrameAt = signal<number | null>(null);

/**
 * Merge, never replace.
 *
 * The 0x1234 pad sends partial frames, and drivers.js strips null keys before
 * emitting, so assigning the incoming object wholesale would blank every field the
 * frame happened not to carry.
 */
export function ingest(patch: Partial<Telemetry>) {
  live.value = { ...live.value, ...patch };
  lastFrameAt.value = Date.now();
}

export function resetTelemetry() {
  live.value = { ...EMPTY };
  lastFrameAt.value = null;
}

/** Below this, a reported speed is noise rather than movement. */
export const MOVING_KMH = 0.05;

/** True when the belt is actually moving, whatever the belt-state code claims. */
export const isMoving = computed(() => (live.value.speedKmh ?? 0) > MOVING_KMH);

/**
 * Positive evidence that the belt is stopped, which is not the same as `!isMoving`.
 *
 * `isMoving` treats "no speed reported yet" as not moving, which is the right default
 * for a status dot and the wrong one for confirming a stop: silence from the pad is
 * not the pad saying zero.
 */
export const confirmedStopped = computed(() => {
  const s = live.value.speedKmh;
  return s != null && s <= MOVING_KMH;
});

/**
 * Positive evidence that the belt is running.
 *
 * Speed alone is not enough: a pad spinning up reports `runState 1` with
 * `CurrentSpeed 0.0` for a second or two before the belt has any speed to report, and
 * treating that gap as a failed start would be wrong. Either signal counts.
 *
 * The label rather than `state`, because `state` is a raw per-protocol code and means
 * nothing on its own: 1 is running on the 0x1234 pad but *starting* on a classic one,
 * whose running code is 2. Every driver normalises the label; none of them agree on
 * the number.
 */
export const confirmedRunning = computed(
  () => isMoving.value || live.value.stateLabel === 'running'
);
