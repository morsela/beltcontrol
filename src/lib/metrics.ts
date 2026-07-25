// Which metrics this connection can honestly show.
//
// The old dashboard rendered six fixed tiles, so on every real device two of them
// were permanently an em dash: FTMS carries no step count, and neither the classic
// nor the 0x1234 frame carries calories. Availability is resolved once, at connect
// time, from the driver's declared capabilities and the per-protocol trust map —
// not re-guessed per render from whether a value happens to be null right now.

import type { TrustMap } from '../state/telemetry.js';
import { fmtDuration, fmt, fmtInt, EM_DASH } from './format.js';
import type { DayTotal } from '../state/session.js';

export type MetricKey = 'time' | 'distance' | 'steps' | 'kcal';

export const METRIC_ORDER: MetricKey[] = ['time', 'distance', 'steps', 'kcal'];

export const METRIC_UNIT: Record<MetricKey, string> = {
  time: 'walked today',
  distance: 'km today',
  steps: 'steps today',
  kcal: 'kcal today',
};

/**
 * Time is always available — it is wall-clock, measured here, and needs no
 * cooperation from the pad. The rest depend on the protocol.
 */
export function availableMetrics(trust: TrustMap | null): MetricKey[] {
  if (!trust) return ['time'];
  const out: MetricKey[] = ['time'];
  if (trust.distKm !== 'absent') out.push('distance');
  if (trust.steps !== 'absent') out.push('steps');
  if (trust.kcal !== 'absent') out.push('kcal');
  return out;
}

/** Advance to the next metric this connection can actually report. */
export function cycleMetric(current: MetricKey, available: MetricKey[]): MetricKey {
  if (available.length === 0) return 'time';
  const i = available.indexOf(current);
  return available[(i + 1) % available.length] ?? available[0]!;
}

export function metricValue(key: MetricKey, day: DayTotal): string {
  switch (key) {
    case 'time': {
      const secs = Math.round(day.minutes * 60);
      return secs > 0 ? fmtDuration(secs) : '0m';
    }
    case 'distance':
      return fmt(day.distKm, 2);
    case 'steps':
      return fmtInt(day.steps);
    case 'kcal':
      return fmtInt(day.kcal);
    default:
      return EM_DASH;
  }
}
