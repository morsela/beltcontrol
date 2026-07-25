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

/** True when the belt is actually moving, whatever the belt-state code claims. */
export const isMoving = computed(() => (live.value.speedKmh ?? 0) > 0.05);
