import { describe, it, expect } from 'vitest';
import { availableMetrics, cycleMetric, metricValue, METRIC_ORDER } from '../src/lib/metrics.js';
import { trustFor } from '../src/state/telemetry.js';
import type { DayTotal } from '../src/state/session.js';

const day = (over: Partial<DayTotal> = {}): DayTotal => ({
  key: '2026-06-09',
  date: 0,
  minutes: 0,
  distKm: 0,
  steps: 0,
  kcal: 0,
  excluded: 0,
  ...over,
});

describe('availableMetrics', () => {
  it('offers only time when nothing is connected', () => {
    expect(availableMetrics(null)).toEqual(['time']);
  });

  it('never drops time — it is wall-clock, not the pad’s', () => {
    for (const id of ['classic', 'ftms', 'ks1234', 'fitshow'] as const) {
      expect(availableMetrics(trustFor(id))).toContain('time');
    }
  });

  it('omits the fields each protocol cannot carry', () => {
    // The whole point: a fixed six-tile grid showed permanent em dashes here.
    expect(availableMetrics(trustFor('classic'))).toEqual(['time', 'distance', 'steps']);
    expect(availableMetrics(trustFor('ftms'))).toEqual(['time', 'distance', 'kcal']);
    expect(availableMetrics(trustFor('fitshow'))).toEqual(['time']);
  });

  it('keeps unverified fields visible — they are shown raw, not hidden', () => {
    expect(availableMetrics(trustFor('ks1234'))).toEqual(['time', 'distance', 'steps', 'kcal']);
  });

  it('yields metrics in the canonical order', () => {
    const got = availableMetrics(trustFor('ks1234'));
    expect(got).toEqual(METRIC_ORDER.filter((k) => got.includes(k)));
  });
});

describe('cycleMetric', () => {
  it('wraps through what is available', () => {
    const avail = availableMetrics(trustFor('ftms')); // time, distance, kcal
    expect(cycleMetric('time', avail)).toBe('distance');
    expect(cycleMetric('distance', avail)).toBe('kcal');
    expect(cycleMetric('kcal', avail)).toBe('time');
  });

  it('skips a metric the protocol cannot report', () => {
    const avail = availableMetrics(trustFor('ftms'));
    expect(cycleMetric('distance', avail)).not.toBe('steps');
  });

  it('recovers when the current metric is no longer available', () => {
    // e.g. reconnecting to an FTMS pad while parked on "steps".
    const avail = availableMetrics(trustFor('ftms'));
    expect(avail).toContain(cycleMetric('steps', avail));
  });

  it('never leaves the hero blank', () => {
    expect(cycleMetric('time', [])).toBe('time');
    expect(cycleMetric('steps', ['time'])).toBe('time');
  });
});

describe('metricValue', () => {
  it('renders a fresh day as 0m rather than an em dash', () => {
    expect(metricValue('time', day())).toBe('0m');
  });

  it('formats each metric to its own precision', () => {
    const d = day({ minutes: 84, distKm: 6.3421, steps: 9123.4, kcal: 271.6 });
    expect(metricValue('time', d)).toBe('1h 24m');
    expect(metricValue('distance', d)).toBe('6.34');
    expect(metricValue('steps', d)).toBe((9123).toLocaleString());
    expect(metricValue('kcal', d)).toBe((272).toLocaleString());
  });

  it('shows sub-minute walks in seconds', () => {
    expect(metricValue('time', day({ minutes: 0.5 }))).toBe('30s');
  });
});
