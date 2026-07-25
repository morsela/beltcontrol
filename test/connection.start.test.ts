import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { doStart, driver, running, startPending, stopPending } from '../src/state/connection.js';
import { ingest, live, resetTelemetry } from '../src/state/telemetry.js';
import { status } from '../src/state/log.js';
import type { Driver } from '../src/lib/drivers.js';

/**
 * The mirror of `connection.stop.test.ts`, and for the same reason: these are about
 * what the app *claims* after writing a start, not about the transport.
 *
 * The bug behind all of it, seen on a real KS-C2: the pad accepted `runState 1`,
 * ignored it, and reported nothing ever again. The app announced "started at 1.8 mph",
 * pinned Stop over a stationary belt, and left no way back to Start — because it had
 * injected a speed reading of its own the instant the write resolved.
 */
function fakePad(over: Partial<Driver> = {}): Driver {
  return {
    id: 'ks1234',
    name: 'fake',
    capabilities: { speed: true, mode: false, incline: false, steps: true, needsPolling: false },
    maxSpeedKmh: 6,
    minSpeedKmh: 0.5,
    speedStep: 0.1,
    onData: null,
    onLog: null,
    attach: async () => {},
    detach: async () => {},
    start: async () => {},
    stop: async () => {},
    setSpeed: async () => {},
    setMode: async () => {},
    poll: async () => {},
    ...over,
  };
}

/** `doStart` waits out the speed-settle delay before resolving. */
async function settle() {
  await vi.advanceTimersByTimeAsync(700);
}

describe('doStart', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetTelemetry();
    running.value = false;
    startPending.value = false;
    stopPending.value = false;
  });

  afterEach(() => {
    driver.value = null;
    vi.useRealTimers();
  });

  it('never fabricates a speed reading the belt did not send', async () => {
    driver.value = fakePad();

    const p = doStart();
    await settle();
    await p;

    // This is the whole bug: the old code ingested 0.6 mph here, so every consumer of
    // telemetry — the Stop bar, the hero number, the stop-confirmation watch — was
    // reading the app's own guess back as if the pad had reported it.
    expect(live.value.speedKmh).toBeNull();
  });

  it('reports running once the belt reports movement, not when the write resolves', async () => {
    driver.value = fakePad();

    const p = doStart();
    await settle();
    await p;

    expect(startPending.value).toBe(true);
    expect(status.value.text).not.toBe('running');

    ingest({ speedKmh: 2.0 });
    await vi.advanceTimersByTimeAsync(300);

    expect(status.value.text).toBe('running');
    expect(status.value.kind).toBe('ok');
    expect(startPending.value).toBe(false);
    expect(running.value).toBe(true);
  });

  // A pad spinning up sends `runState 1` with `CurrentSpeed 0.0` for a second or two
  // before the belt has any speed to report. That is a confirmed start, not a failed one.
  it('accepts a reported run state as confirmation before any speed arrives', async () => {
    driver.value = fakePad();

    const p = doStart();
    await settle();
    await p;

    ingest({ speedKmh: 0, state: 1 });
    await vi.advanceTimersByTimeAsync(300);

    expect(status.value.text).toBe('running');
    expect(startPending.value).toBe(false);
  });

  it('gives the Start button back when the belt never confirms', async () => {
    driver.value = fakePad();

    const p = doStart();
    await settle();
    await p;

    expect(running.value).toBe(true); // Stop stays reachable while it might be moving

    await vi.advanceTimersByTimeAsync(10_500);

    // `Now` offers Start on `!isMoving && !running`, so this is the assertion that the
    // button stops saying "Stop" after a start the pad ignored.
    expect(running.value).toBe(false);
    expect(startPending.value).toBe(false);
    expect(status.value.kind).toBe('err');
    expect(status.value.text).toMatch(/never reported movement/);
  });

  it('keeps treating the belt as running when the speed write fails after a good start', async () => {
    driver.value = fakePad({
      setSpeed: async () => {
        throw new Error('write failed');
      },
    });

    const p = doStart();
    await settle();
    await p;

    // The start itself went out. A failed follow-up speed write says nothing about
    // whether the belt moved, so the confirmation is still the thing to wait on.
    expect(running.value).toBe(true);
    expect(startPending.value).toBe(true);
    expect(status.value.kind).toBe('err');
  });

  it('leaves nothing outstanding when the start write itself failed', async () => {
    driver.value = fakePad({
      start: async () => {
        throw new Error('not connected to the pad — command not sent');
      },
    });

    await doStart();

    expect(running.value).toBe(false);
    expect(startPending.value).toBe(false);
    expect(status.value.kind).toBe('err');
    expect(status.value.text).toMatch(/not sent/);
  });
});
