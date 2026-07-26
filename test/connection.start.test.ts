import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  doStart,
  doResume,
  doStop,
  driver,
  paused,
  running,
  startPending,
  stopPending,
} from '../src/state/connection.js';
import { ingest, live, resetTelemetry } from '../src/state/telemetry.js';
import { status } from '../src/state/log.js';
import type { Driver, StartVerdict } from '../src/lib/drivers.js';

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
    capabilities: {
      speed: true,
      mode: false,
      incline: false,
      steps: true,
      pause: false,
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
    stop: async () => {},
    pause: async () => {
      throw new Error('this fake pad has no pause');
    },
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

/**
 * A pad that answers each start in turn from `verdicts`, and counts what it was sent.
 *
 * Anything past the end of the list is `'unknown'` — the answer from every protocol that
 * cannot answer at all, which is all of them but the 0x1234.
 */
function answeringPad(verdicts: StartVerdict[], over: Partial<Driver> = {}) {
  const counter = { attempts: 0 };
  let i = 0;
  const d = fakePad({
    start: async () => {
      counter.attempts++;
    },
    startVerdict: async () => verdicts[i++] ?? 'unknown',
    ...over,
  });
  return { d, counter };
}

/** Long enough for three attempts, the two retry gaps between them, and the settle. */
async function retries() {
  await vi.advanceTimersByTimeAsync(2500);
}

describe('doStart', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetTelemetry();
    running.value = false;
    paused.value = false;
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
  // The label is what carries it: `state` is a raw per-protocol code, 1 meaning running
  // on this pad and *starting* on a classic one. Drivers always emit the pair.
  it('accepts a reported run state as confirmation before any speed arrives', async () => {
    driver.value = fakePad();

    const p = doStart();
    await settle();
    await p;

    ingest({ speedKmh: 0, state: 1, stateLabel: 'running' });
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

  // A pad sitting there reports `stopped` right up to the moment Start is pressed, and
  // that frame is still the newest one when the app raises `running`. Taken as evidence
  // of a belt that stopped itself — which is what the self-stop watcher is looking for —
  // it cancels the start on the spot, before the belt has had a chance to answer.
  it('does not read the zero from before the press as a belt that stopped itself', async () => {
    driver.value = fakePad();
    ingest({ speedKmh: 0, state: 5, stateLabel: 'stopped' });

    const p = doStart();
    await settle();
    await p;

    expect(running.value).toBe(true);
    expect(startPending.value).toBe(true);
  });

  it('lets the belt say it stopped itself once the start has been confirmed', async () => {
    driver.value = fakePad();
    ingest({ speedKmh: 0, state: 5, stateLabel: 'stopped' });

    const p = doStart();
    await settle();
    await p;

    ingest({ speedKmh: 2.0, state: 2, stateLabel: 'running' });
    await vi.advanceTimersByTimeAsync(300);
    expect(running.value).toBe(true);

    // Nobody stepped on, so the pad gives up on its own a few seconds later.
    ingest({ speedKmh: 0, state: 5, stateLabel: 'stopped' });

    expect(running.value).toBe(false);
    expect(status.value.text).toMatch(/stopped on its own/);
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

  // A resume drops `paused` on the way out, because a Resume button in front of a belt
  // that was just told to go is wrong. If the belt then never goes, the walk is exactly
  // where it was and the button has to come back with it — otherwise the pause is lost
  // and the held-open session gets filed as over.
  it('puts the belt back to paused when a resume never confirms', async () => {
    driver.value = fakePad();
    paused.value = true;

    const p = doResume();
    await settle();
    await p;

    expect(paused.value).toBe(false); // told to go; not paused any more as far as we know

    await vi.advanceTimersByTimeAsync(10_500);

    expect(paused.value).toBe(true);
    expect(running.value).toBe(false);
    expect(status.value.text).toMatch(/Resume was sent/);
  });

  it('leaves the belt paused when the resume write itself failed', async () => {
    driver.value = fakePad({
      start: async () => {
        throw new Error('not connected to the pad — command not sent');
      },
    });
    paused.value = true;

    await doResume();

    expect(paused.value).toBe(true);
    expect(running.value).toBe(false);
  });

  /**
   * From a real KS-C2 log: two starts refused with `ErrorCode -5000` a second apart, then
   * an identical third the pad simply took. Every attempt was a hand pressing the button,
   * with ten seconds of the app insisting nothing had happened in between.
   */
  describe('when the pad refuses the start', () => {
    it('sends it again, and stops as soon as one lands', async () => {
      const { d, counter } = answeringPad(['refused', 'refused', 'accepted']);
      driver.value = d;

      const p = doStart();
      await retries();
      await p;

      expect(counter.attempts).toBe(3);
      expect(running.value).toBe(true);
      // Accepted is not moving: the belt still has to say so itself.
      expect(startPending.value).toBe(true);
      expect(status.value.kind).not.toBe('err');
    });

    it('gives up after three, and says the belt refused rather than that it went quiet', async () => {
      const { d, counter } = answeringPad(['refused', 'refused', 'refused']);
      driver.value = d;

      const p = doStart();
      await retries();
      await p;

      expect(counter.attempts).toBe(3);
      expect(running.value).toBe(true); // Stop stays reachable while it might yet move

      await vi.advanceTimersByTimeAsync(10_500);

      expect(running.value).toBe(false);
      expect(status.value.kind).toBe('err');
      expect(status.value.text).toMatch(/refused each one/);
      expect(status.value.text).not.toMatch(/never reported movement/);
    });

    it('does not re-send it to a belt that is moving anyway', async () => {
      // The refusal is the pad's account of the command, not of the belt. A belt that is
      // under way outranks it, and a second start is the one retry with a person on it.
      const { d, counter } = answeringPad(['refused', 'accepted']);
      driver.value = d;

      const p = doStart();
      ingest({ speedKmh: 2.0 });
      await retries();
      await p;

      expect(counter.attempts).toBe(1);
      expect(running.value).toBe(true);
    });

    it('abandons the sequence when somebody presses Stop mid-way', async () => {
      const { d, counter } = answeringPad(['refused', 'refused', 'accepted']);
      driver.value = d;

      const p = doStart();
      await vi.advanceTimersByTimeAsync(100); // inside the first retry gap
      expect(counter.attempts).toBe(1);

      await doStop();
      await vi.advanceTimersByTimeAsync(3000);
      await p;

      // The whole point of the generation check: no start goes on the wire behind the
      // back of whoever just asked the belt to stop.
      expect(counter.attempts).toBe(1);
    });

    // A refused start leaves the pad reporting a stationary belt, which is the exact
    // shape the self-stop watcher reads as "it stopped by itself". Without `startPending`
    // held up across the whole sequence it would file the walk between attempts.
    it('does not read the stillness between attempts as a belt stopping itself', async () => {
      const { d, counter } = answeringPad(['refused', 'accepted']);
      driver.value = d;

      const p = doStart();
      ingest({ speedKmh: 0, state: 0, stateLabel: 'stopped' });
      await retries();
      await p;

      expect(counter.attempts).toBe(2);
      expect(running.value).toBe(true);
      expect(status.value.text).not.toMatch(/stopped on its own/);
    });

    it('leaves a refused resume paused, exactly as an unconfirmed one', async () => {
      const { d } = answeringPad(['refused', 'refused', 'refused']);
      driver.value = d;
      paused.value = true;

      const p = doResume();
      await retries();
      await p;
      await vi.advanceTimersByTimeAsync(10_500);

      expect(paused.value).toBe(true);
      expect(running.value).toBe(false);
      expect(status.value.text).toMatch(/^Resume was sent/);
    });
  });

  it('sends exactly one start to a pad that cannot answer for itself', async () => {
    // Every protocol but the 0x1234. Nothing to read, so nothing to retry on — the
    // behaviour here is what it was before any of this existed.
    const { d, counter } = answeringPad([]);
    driver.value = d;

    const p = doStart();
    await retries();
    await p;

    expect(counter.attempts).toBe(1);
    expect(startPending.value).toBe(true);
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
