import { describe, it, expect, beforeEach } from 'vitest';
import {
  live,
  lastFrameAt,
  ingest,
  resetTelemetry,
  isMoving,
  confirmedRunning,
  trustFor,
  EMPTY,
} from '../src/state/telemetry.js';

beforeEach(() => resetTelemetry());

describe('ingest', () => {
  it('merges rather than replaces', () => {
    // The 0x1234 pad sends partial frames and drivers.js strips null keys, so a
    // wholesale assign would blank every field the frame did not happen to carry.
    ingest({ speedKmh: 3.2, steps: 400 });
    ingest({ speedKmh: 3.4 });
    expect(live.value.speedKmh).toBe(3.4);
    expect(live.value.steps).toBe(400);
  });

  it('lets a driver clear a field explicitly', () => {
    ingest({ kcal: 12 });
    ingest({ kcal: null });
    expect(live.value.kcal).toBeNull();
  });

  it('stamps the frame clock for staleness detection', () => {
    const before = Date.now();
    ingest({ speedKmh: 1 });
    expect(lastFrameAt.value).toBeGreaterThanOrEqual(before);
  });
});

describe('resetTelemetry', () => {
  it('clears every field and the frame clock', () => {
    ingest({ speedKmh: 5, distKm: 2, steps: 10 });
    resetTelemetry();
    expect(live.value).toEqual(EMPTY);
    expect(lastFrameAt.value).toBeNull();
  });
});

describe('isMoving', () => {
  it('is false with no connection at all', () => {
    expect(isMoving.value).toBe(false);
  });

  it('ignores the belt-state code and trusts the speed', () => {
    // A pad can report state "running" while the belt is stationary, and vice
    // versa during a ramp-down; sessions must key off actual movement.
    ingest({ speedKmh: 0, state: 2, stateLabel: 'running' });
    expect(isMoving.value).toBe(false);
    ingest({ speedKmh: 1.2, state: 5, stateLabel: 'stopped' });
    expect(isMoving.value).toBe(true);
  });

  it('treats sensor jitter near zero as still', () => {
    ingest({ speedKmh: 0.04 });
    expect(isMoving.value).toBe(false);
    ingest({ speedKmh: 0.06 });
    expect(isMoving.value).toBe(true);
  });
});

describe('confirmedRunning', () => {
  it('needs positive evidence, not merely the absence of movement', () => {
    expect(confirmedRunning.value).toBe(false);
    ingest({ speedKmh: 1.2 });
    expect(confirmedRunning.value).toBe(true);
  });

  // `state` is a raw per-protocol code, so it means nothing on its own: the 0x1234 pad
  // reports 1 for running, while the classic pad reports 1 for *starting* and 2 for
  // running. The label is the part every driver normalises.
  it('reads the normalised label rather than a protocol-specific state code', () => {
    ingest({ speedKmh: 0, state: 1, stateLabel: 'running' }); // 0x1234 spinning up
    expect(confirmedRunning.value).toBe(true);

    resetTelemetry();
    ingest({ speedKmh: 0, state: 2, stateLabel: 'running' }); // classic, same situation
    expect(confirmedRunning.value).toBe(true);

    resetTelemetry();
    ingest({ speedKmh: 0, state: 1, stateLabel: 'starting' }); // classic code 1 is not running
    expect(confirmedRunning.value).toBe(false);
  });
});

describe('trustFor', () => {
  it('matches the documented per-protocol capability table', () => {
    expect(trustFor('classic')).toEqual({ distKm: 'ok', steps: 'ok', kcal: 'absent' });
    expect(trustFor('ftms')).toEqual({ distKm: 'ok', steps: 'absent', kcal: 'ok' });
    expect(trustFor('ks1234')).toEqual({ distKm: 'ok', steps: 'ok', kcal: 'unverified' });
    expect(trustFor('fitshow')).toEqual({ distKm: 'absent', steps: 'absent', kcal: 'absent' });
  });

  it('trusts nothing when the protocol is unknown', () => {
    expect(trustFor(null)).toEqual({ distKm: 'absent', steps: 'absent', kcal: 'absent' });
  });
});
