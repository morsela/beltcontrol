import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  doStop,
  doPause,
  driver,
  running,
  stopPending,
  startPending,
  paused,
  canPause,
  phase,
} from '../src/state/connection.js';
import { ingest, resetTelemetry } from '../src/state/telemetry.js';
import { status } from '../src/state/log.js';
import type { Driver } from '../src/lib/drivers.js';

/**
 * `driver` is an exported signal, so a fake pad can be dropped straight in without
 * going near navigator.bluetooth — these tests are about what the app *claims* after
 * writing a stop command, not about the transport.
 */
function fakePad(
  stop: () => Promise<void>,
  opts: { pause?: Driver['pause']; hasPause?: boolean } = {}
): Driver {
  return {
    id: 'ks1234',
    name: 'fake',
    capabilities: {
      speed: true,
      mode: false,
      incline: false,
      steps: true,
      pause: opts.hasPause ?? false,
      needsPolling: false,
    },
    maxSpeedKmh: 6,
    minSpeedKmh: 0.5,
    speedStep: 0.1,
    onData: null,
    onLog: null,
    attach: async () => {},
    detach: async () => {},
    start: async () => {},
    stop,
    pause:
      opts.pause ??
      (async () => {
        throw new Error('this fake pad has no pause');
      }),
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

describe('doPause', () => {
  const pausingPad = () => fakePad(async () => {}, { pause: async () => 'paused', hasPause: true });

  beforeEach(() => {
    vi.useFakeTimers();
    resetTelemetry();
    running.value = true;
    stopPending.value = false;
    paused.value = false;
    phase.value = 'connected'; // so `canPause` is answering about the pad, not the link
  });

  afterEach(() => {
    driver.value = null;
    paused.value = false;
    phase.value = 'idle';
    vi.useRealTimers();
  });

  it('does not claim a pause until the belt reports zero', async () => {
    driver.value = pausingPad();
    ingest({ speedKmh: 3.2 }); // still coasting down as the command goes out

    await doPause();

    expect(paused.value).toBe(false);
    expect(running.value).toBe(true);
    expect(status.value.text).toMatch(/waiting|pause sent/i);
  });

  it('reports paused once the belt reports zero', async () => {
    driver.value = pausingPad();
    ingest({ speedKmh: 3.2 });

    await doPause();
    ingest({ speedKmh: 0 });
    vi.advanceTimersByTime(300);

    expect(status.value.text).toBe('paused');
    expect(status.value.kind).toBe('ok');
    expect(paused.value).toBe(true);
    expect(running.value).toBe(false);
  });

  it('offers no Resume button when the belt never confirms the pause', async () => {
    // The whole point: a Resume button in front of a belt that is still moving would be
    // an invitation to step onto it.
    driver.value = pausingPad();
    ingest({ speedKmh: 3.2 });

    await doPause();
    vi.advanceTimersByTime(6_500);

    expect(paused.value).toBe(false);
    expect(running.value).toBe(true);
    expect(status.value.kind).toBe('err');
    expect(status.value.text).toMatch(/Pause was sent but the belt has not confirmed/);
  });

  it('stops the belt and retires the button when the unit has no pause', async () => {
    driver.value = fakePad(async () => {}, { pause: async () => 'stopped', hasPause: true });
    ingest({ speedKmh: 3.2 });

    expect(canPause.value).toBe(true);
    await doPause();

    expect(canPause.value).toBe(false);
    expect(paused.value).toBe(false);
    // Still held to the same evidence: the fallback stop is confirmed, not assumed.
    ingest({ speedKmh: 0 });
    vi.advanceTimersByTime(300);
    expect(status.value.text).toBe('stopped');
    expect(running.value).toBe(false);
  });

  it('drops the pause when the belt starts moving again by itself', async () => {
    driver.value = pausingPad();
    ingest({ speedKmh: 3.2 });
    await doPause();
    ingest({ speedKmh: 0 });
    vi.advanceTimersByTime(300);
    expect(paused.value).toBe(true);

    ingest({ speedKmh: 2.4 }); // somebody used the pad's own remote
    expect(paused.value).toBe(false);
  });
});

/**
 * The other way a belt stops: by itself. Start one with nobody on it and it gives up
 * after a few seconds; the key gets pulled; somebody uses its own panel. No command
 * comes back to the app, so `running` used to stay true for the rest of the connection
 * — Stop pinned over a belt the pad itself was reporting as stopped, and no way back to
 * Start without pressing a Stop that did nothing.
 */
describe('a belt that stops itself', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetTelemetry();
    running.value = true;
    stopPending.value = false;
    startPending.value = false;
  });

  afterEach(() => {
    driver.value = null;
    running.value = false;
    vi.useRealTimers();
  });

  it('takes a reported resting state at once', () => {
    ingest({ speedKmh: 3.2, state: 2, stateLabel: 'running' });
    expect(running.value).toBe(true);

    ingest({ speedKmh: 0, state: 5, stateLabel: 'stopped' });

    expect(running.value).toBe(false);
    expect(status.value.text).toMatch(/stopped on its own/);
    expect(status.value.kind).toBe('ok');
  });

  it('treats standby and idle the same way', () => {
    ingest({ speedKmh: 0, state: 0, stateLabel: 'standby' });
    expect(running.value).toBe(false);
  });

  it('waits out a coast-down rather than calling it stopped', () => {
    // `stopping` is the pad still decelerating, and it reports it alongside a speed
    // that has not reached zero yet.
    ingest({ speedKmh: 1.4, state: 3, stateLabel: 'stopping' });
    vi.advanceTimersByTime(5_000);
    expect(running.value).toBe(true);
  });

  it('gives a protocol that reports no state at all a grace period', () => {
    // FTMS carries no belt-state code, so bare zero speed is all there is to go on —
    // and a pad that has confirmed a start reports exactly that for a moment before
    // the belt has any speed to report.
    ingest({ speedKmh: 0 });
    vi.advanceTimersByTime(2_000);
    expect(running.value).toBe(true);

    vi.advanceTimersByTime(1_500);
    expect(running.value).toBe(false);
  });

  it('lets the belt pick back up inside that grace period', () => {
    ingest({ speedKmh: 0 });
    vi.advanceTimersByTime(2_000);
    ingest({ speedKmh: 1.2 }); // the belt was only spinning up
    vi.advanceTimersByTime(5_000);
    expect(running.value).toBe(true);
  });

  it('leaves an unconfirmed start alone', () => {
    // A start that has been written and not yet answered is a belt legitimately
    // reporting zero. `watchForStart` owns that window and its ten-second deadline.
    startPending.value = true;
    ingest({ speedKmh: 0, state: 5, stateLabel: 'stopped' });
    vi.advanceTimersByTime(5_000);
    expect(running.value).toBe(true);
  });

  it('does not describe a stop somebody asked for as the belt stopping itself', async () => {
    driver.value = fakePad(async () => {});
    ingest({ speedKmh: 3.2 });

    await doStop();
    ingest({ speedKmh: 0, state: 5, stateLabel: 'stopped' });
    vi.advanceTimersByTime(300);

    expect(running.value).toBe(false);
    expect(status.value.text).toBe('stopped');
  });
});
