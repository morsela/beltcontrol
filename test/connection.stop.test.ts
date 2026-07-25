import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { doStop, driver, running, stopPending } from '../src/state/connection.js';
import { ingest, resetTelemetry } from '../src/state/telemetry.js';
import { status } from '../src/state/log.js';
import type { Driver } from '../src/lib/drivers.js';

/**
 * `driver` is an exported signal, so a fake pad can be dropped straight in without
 * going near navigator.bluetooth — these tests are about what the app *claims* after
 * writing a stop command, not about the transport.
 */
function fakePad(stop: () => Promise<void>): Driver {
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
    stop,
    setSpeed: async () => {},
    setMode: async () => {},
    poll: async () => {},
  };
}

describe('doStop', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetTelemetry();
    running.value = true;
    stopPending.value = false;
  });

  afterEach(() => {
    driver.value = null;
    vi.useRealTimers();
  });

  it('reports stopped once the belt reports zero, not when the write resolves', async () => {
    driver.value = fakePad(async () => {});
    ingest({ speedKmh: 3.2 }); // still moving as the command goes out

    await doStop();

    // The write has resolved, but the belt has not said anything yet.
    expect(status.value.text).toMatch(/waiting|stop sent/i);
    expect(running.value).toBe(true);

    ingest({ speedKmh: 0 }); // the pad reports zero
    vi.advanceTimersByTime(300);

    expect(status.value.text).toBe('stopped');
    expect(status.value.kind).toBe('ok');
    expect(running.value).toBe(false);
  });

  it('confirms immediately when the belt is already reporting zero', async () => {
    driver.value = fakePad(async () => {});
    ingest({ speedKmh: 0 });

    await doStop();

    expect(status.value.text).toBe('stopped');
    expect(running.value).toBe(false);
  });

  it('says so when the belt never confirms, and keeps treating it as running', async () => {
    driver.value = fakePad(async () => {});
    ingest({ speedKmh: 3.2 });

    await doStop();
    vi.advanceTimersByTime(6_500);

    expect(status.value.kind).toBe('err');
    expect(status.value.text).toMatch(/has not confirmed/);
    expect(status.value.text).toMatch(/2\.0 mph/); // 3.2 km/h, still moving
    expect(status.value.text).toMatch(/treadmill's own controls/);
    // Not downgraded to "stopped": the belt may still be moving.
    expect(running.value).toBe(true);
  });

  it('distinguishes silence from a reported zero', async () => {
    driver.value = fakePad(async () => {});
    // No telemetry at all. `isMoving` is false here, but that is the absence of
    // evidence, not evidence of a stopped belt.

    await doStop();
    vi.advanceTimersByTime(6_500);

    expect(status.value.kind).toBe('err');
    expect(status.value.text).toMatch(/not reporting speed at all/);
  });

  // `Now` shows "Start command sent — waiting for the belt to report movement" on
  // `running && !isMoving`, and an unconfirmed stop satisfies both. Without this flag a
  // pad that has gone silent mid-stop gets described as a pending *start*.
  it('marks a stop outstanding until the belt confirms it', async () => {
    driver.value = fakePad(async () => {});
    ingest({ speedKmh: 3.2 });

    await doStop();
    expect(stopPending.value).toBe(true);

    ingest({ speedKmh: 0 });
    vi.advanceTimersByTime(300);
    expect(stopPending.value).toBe(false);
  });

  it('keeps the stop outstanding past the deadline, alongside `running`', async () => {
    driver.value = fakePad(async () => {});
    ingest({ speedKmh: 3.2 });

    await doStop();
    vi.advanceTimersByTime(6_500);

    // Same reasoning as `running` staying true: the belt never confirmed, so the stop
    // is still the last thing this app asked of it.
    expect(stopPending.value).toBe(true);
    expect(running.value).toBe(true);
  });

  it('leaves nothing outstanding when the write itself failed', async () => {
    driver.value = fakePad(async () => {
      throw new Error('not connected to the pad — command not sent');
    });
    ingest({ speedKmh: 3.2 });

    await doStop();

    expect(stopPending.value).toBe(false);
  });

  it('surfaces a write that failed instead of reporting a stop', async () => {
    driver.value = fakePad(async () => {
      throw new Error('not connected to the pad — command not sent');
    });
    ingest({ speedKmh: 3.2 });

    await doStop();

    expect(status.value.kind).toBe('err');
    expect(status.value.text).toMatch(/command not sent/);

    // And no confirmation watcher is left running to overwrite that with "stopped".
    ingest({ speedKmh: 0 });
    vi.advanceTimersByTime(1_000);
    expect(status.value.kind).toBe('err');
  });
});
