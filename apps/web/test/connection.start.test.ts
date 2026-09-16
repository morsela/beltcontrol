import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  disconnect,
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
import { updateSettings } from '../src/state/settings.js';
import { setAnalyticsProvider } from '../src/lib/analytics.js';
import { clearLog, logLines, status } from '../src/state/log.js';
import type { Driver, StartVerdict } from '@beltcontrol/belt-drivers';

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

/** Long enough for the belt-is-moving check, the settle after it, and one speed write. */
async function upToSpeed() {
  await vi.advanceTimersByTimeAsync(1200);
}

/** A pad that records every speed it is asked for and does nothing else about them —
 *  what the belt then reports is the test's to say, frame by frame, as it is on the wire. */
function speedPad(over: Partial<Driver> = {}) {
  const writes: number[] = [];
  const d = fakePad({
    setSpeed: async (kmh: number) => {
      writes.push(kmh);
    },
    ...over,
  });
  return { d, writes };
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
    setAnalyticsProvider(null);
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

    // The speed only goes out once the belt is moving — see the suite below — so this
    // is what it takes to reach the failing write at all.
    ingest({ speedKmh: 1.0, state: 1, stateLabel: 'running' });
    await upToSpeed();

    // The start itself went out. A failed follow-up speed write says nothing about
    // whether the belt moved, so the start confirmation still stands.
    expect(running.value).toBe(true);
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

    it('points at the child lock when the pad has said it is on', async () => {
      // KS+Fit's own advice for this error checks the safety lock first. When the pad
      // has reported the lock engaged, the generic "its own panel still has control"
      // gives way to the one instruction that names a switch the user can flip.
      const { d } = answeringPad(['refused', 'refused', 'refused'], { childLockOn: true });
      driver.value = d;

      const p = doStart();
      await retries();
      await p;
      await vi.advanceTimersByTimeAsync(10_500);

      expect(status.value.kind).toBe('err');
      expect(status.value.text).toMatch(/child lock is on/);
      expect(status.value.text).toMatch(/unlock it from the panel/i);
    });

    it('keeps the panel advice when the pad reports the lock off', async () => {
      const { d } = answeringPad(['refused', 'refused', 'refused'], { childLockOn: false });
      driver.value = d;

      const p = doStart();
      await retries();
      await p;
      await vi.advanceTimersByTimeAsync(10_500);

      expect(status.value.text).toMatch(/own panel still has control/);
      expect(status.value.text).toMatch(/panel or remote/);
      expect(status.value.text).not.toMatch(/child lock/);
      // A real KS-C2 refused three starts, was disconnected and reconnected, and refused
      // three more identically. Reconnecting is not advice this message may give.
      expect(status.value.text).not.toMatch(/reconnect/);
    });

    it('says the pad looks asleep when it has the standby signature', async () => {
      // The same KS-C2, left stopped for an hour: no ControlMode 1 echo, no config
      // dump, and -5000 to every start. The vendor's documentation says the panel or
      // remote wakes it; the app's job is to point there, not at the connect button.
      const { d } = answeringPad(['refused', 'refused', 'refused'], { asleep: true });
      driver.value = d;

      const p = doStart();
      await retries();
      await p;
      await vi.advanceTimersByTimeAsync(10_500);

      expect(status.value.kind).toBe('err');
      expect(status.value.text).toMatch(/looks asleep/);
      expect(status.value.text).toMatch(/wake it from its panel or remote/i);
      expect(status.value.text).toMatch(/reconnecting will not help/i);
      expect(status.value.text).not.toMatch(/own panel still has control/);
    });

    it('lets the child lock outrank the standby reading', async () => {
      // The lock is a switch the pad has named; standby is a shape read off the log.
      const { d } = answeringPad(['refused', 'refused', 'refused'], {
        childLockOn: true,
        asleep: true,
      });
      driver.value = d;

      const p = doStart();
      await retries();
      await p;
      await vi.advanceTimersByTimeAsync(10_500);

      expect(status.value.text).toMatch(/child lock is on/);
      expect(status.value.text).not.toMatch(/looks asleep/);
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

    // From a real KS-C2 in standby: three refusals, `runState 0` after the last one, and
    // ten seconds later "belt reports itself stopped — nobody sent a stop" a moment before
    // the real message. The deadline branch dropped `startPending` a beat before
    // `running`, and in that beat the self-stop watcher saw a running belt reporting
    // rest and filed a stop for a belt that never moved.
    it('does not file a self-stop when the pad refused every attempt', async () => {
      const track = vi.fn();
      setAnalyticsProvider({ track });
      clearLog();
      const { d } = answeringPad(['refused', 'refused', 'refused']);
      driver.value = d;

      const p = doStart();
      await retries();
      await p;
      // The pad's own account after the last refusal, newer than the last start.
      ingest({ speedKmh: 0, state: 0, stateLabel: 'stopped' });
      await vi.advanceTimersByTimeAsync(10_500);

      expect(running.value).toBe(false);
      expect(status.value.kind).toBe('err');
      expect(status.value.text).toMatch(/refused each one/);
      expect(logLines.value.map((l) => l.msg)).not.toContainEqual(
        expect.stringMatching(/stopped on its own|nobody sent a stop/)
      );
      expect(track.mock.calls.map(([name]) => name)).not.toContain('belt_self_stopped');
      expect(track).toHaveBeenCalledWith(
        'start_unconfirmed',
        expect.objectContaining({ refused: true })
      );
    });

    // The same beat on the way out: a disconnect inside the confirmation window dropped
    // `startPending` in teardown while `running` was still up, with the pad's last
    // `runState 0` on record.
    it('does not file a self-stop when the link goes while the pad is still refusing', async () => {
      const track = vi.fn();
      setAnalyticsProvider({ track });
      clearLog();
      const { d } = answeringPad(['refused', 'refused', 'refused']);
      driver.value = d;

      const p = doStart();
      await retries();
      await p;
      ingest({ speedKmh: 0, state: 0, stateLabel: 'stopped' });
      await disconnect();

      expect(running.value).toBe(false);
      expect(status.value.text).toBe('disconnected');
      expect(logLines.value.map((l) => l.msg)).not.toContainEqual(
        expect.stringMatching(/stopped on its own|nobody sent a stop/)
      );
      expect(track.mock.calls.map(([name]) => name)).not.toContain('belt_self_stopped');
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

  /**
   * A start carries no speed. The belt moves off at the pad's own crawl — 1.0 km/h on a
   * KS-C2 — and climbs only when a `setSpeed` reaches it.
   *
   * That write used to go out on a fixed 600ms timer, which put it in front of a pad
   * still reporting `runState 0`, where it was taken and dropped without a word. Every
   * walk then ran at 0.6 mph for its whole length unless somebody pressed + or − — and
   * that worked only because it wrote the same value a second time, to a belt that was
   * by then moving. The log that settled it is quoted in `bringUpToTarget`.
   */
  describe('bringing the belt up to the chosen speed', () => {
    /** 2.0 mph — the "desk" preset, and the target in the report. */
    const TARGET = 3.2;

    beforeEach(() => {
      updateSettings({ targetKmh: TARGET });
    });

    afterEach(() => {
      updateSettings({ targetKmh: 1.0 });
      setAnalyticsProvider(null);
    });

    /** The pad reporting its own start speed, which is where the bug left every walk. */
    function crawls() {
      ingest({ speedKmh: 1.0, state: 1, stateLabel: 'running' });
    }

    it('writes nothing at a belt that has not reported movement', async () => {
      const { d, writes } = speedPad();
      driver.value = d;

      const p = doStart();
      await vi.advanceTimersByTimeAsync(3000);
      await p;

      expect(writes).toEqual([]);
    });

    it('writes the target once the belt says it is moving', async () => {
      const { d, writes } = speedPad();
      driver.value = d;

      const p = doStart();
      await settle();
      await p;
      expect(writes).toEqual([]);

      crawls();
      await upToSpeed();

      expect(writes).toEqual([TARGET]);
    });

    it('brings a resumed walk up to the target too', async () => {
      // The capture behind all of this is a resume: same command, same race, and a
      // walk picked back up at 0.6 mph.
      const { d, writes } = speedPad();
      driver.value = d;
      paused.value = true;

      const p = doResume();
      await settle();
      await p;
      crawls();
      await upToSpeed();

      expect(writes).toEqual([TARGET]);
    });

    it('leaves it at one write when the belt takes it', async () => {
      const { d, writes } = speedPad();
      driver.value = d;

      const p = doStart();
      await settle();
      await p;
      crawls();
      await upToSpeed();

      // A pad that took the setpoint ramps, roughly as the real one does.
      for (const kmh of [1.8, 2.5, 3.1, 3.2]) {
        ingest({ speedKmh: kmh });
        await vi.advanceTimersByTimeAsync(500);
      }
      await vi.advanceTimersByTimeAsync(8000);

      expect(writes).toEqual([TARGET]);
      expect(status.value.kind).not.toBe('err');
    });

    it('waits out a slow ramp rather than writing over it', async () => {
      const { d, writes } = speedPad();
      driver.value = d;

      const p = doStart();
      await settle();
      await p;
      crawls();
      await upToSpeed();

      // Climbing, but slowly, and never resting long enough to look stalled.
      for (let kmh = 1.2; kmh < 3.2; kmh += 0.2) {
        ingest({ speedKmh: Number(kmh.toFixed(1)) });
        await vi.advanceTimersByTimeAsync(1000);
      }

      expect(writes).toEqual([TARGET]);
    });

    it('waits out a belt on its way down to a lower setpoint', async () => {
      // The rarer direction, and the one a climb-only check would have re-sent into:
      // a belt decelerating correctly is not a pad ignoring the write.
      const { d, writes } = speedPad();
      driver.value = d;
      ingest({ speedKmh: 5.0, state: 1, stateLabel: 'running' }); // started from the panel

      const p = doStart();
      await settle();
      await p;
      await upToSpeed();
      expect(writes).toEqual([TARGET]);

      for (const kmh of [4.4, 3.9, 3.5, 3.2]) {
        ingest({ speedKmh: kmh });
        await vi.advanceTimersByTimeAsync(1000);
      }

      expect(writes).toEqual([TARGET]);
    });

    it('writes it again when the belt holds a speed above the target', async () => {
      // The other half of measuring the distance to the setpoint rather than the speed:
      // a belt sitting above the target has not taken the write either.
      const { d, writes } = speedPad();
      driver.value = d;
      ingest({ speedKmh: 5.0, state: 1, stateLabel: 'running' });

      const p = doStart();
      await settle();
      await p;
      await upToSpeed();
      await vi.advanceTimersByTimeAsync(3000);

      expect(writes).toEqual([TARGET, TARGET]);
    });

    it('writes it again when the belt holds the start speed instead', async () => {
      const { d, writes } = speedPad();
      driver.value = d;

      const p = doStart();
      await settle();
      await p;
      crawls();
      await upToSpeed();
      expect(writes).toEqual([TARGET]);

      // Nothing more from the pad: 1.0 km/h, steady, which is exactly what a dropped
      // write looks like from here.
      await vi.advanceTimersByTimeAsync(3000);

      expect(writes).toEqual([TARGET, TARGET]);
    });

    it('gives up after three and says which speed the belt is holding', async () => {
      const { d, writes } = speedPad();
      driver.value = d;

      const p = doStart();
      await settle();
      await p;
      crawls();
      await vi.advanceTimersByTimeAsync(12_000);

      expect(writes).toEqual([TARGET, TARGET, TARGET]);
      expect(running.value).toBe(true); // it is walking, just not at the speed asked for
      expect(status.value.kind).toBe('err');
      expect(status.value.text).toMatch(/running at 0.6 mph/);
      expect(status.value.text).toMatch(/2.0 mph/);
      expect(status.value.text).toMatch(/press \+ or −/i);
    });

    it('stops writing at a belt that reports no speed at all', async () => {
      // Confirmation by run state alone, and never a speed reading after it. Nothing
      // to check the write against, so re-sending is just a second write into silence.
      const { d, writes } = speedPad();
      driver.value = d;

      const p = doStart();
      await settle();
      await p;
      ingest({ state: 1, stateLabel: 'running' });
      await vi.advanceTimersByTimeAsync(12_000);

      expect(writes).toEqual([TARGET]);
      expect(status.value.kind).not.toBe('err');
    });

    it('abandons the job when somebody presses Stop part way through', async () => {
      const { d, writes } = speedPad();
      driver.value = d;

      const p = doStart();
      await settle();
      await p;
      crawls();
      await upToSpeed();
      expect(writes).toEqual([TARGET]);

      await doStop();
      await vi.advanceTimersByTimeAsync(8000);

      // No speed goes on the wire behind the back of whoever just stopped the belt.
      expect(writes).toEqual([TARGET]);
    });

    it('stops writing at a belt that went to rest, without waiting on the self-stop watch', async () => {
      // A protocol that carries no state code — FTMS — is only read as self-stopped
      // after three seconds of zero, and the stall below fires at two and a half. Left
      // to `running`, the belt going still reads as a dropped write and earns one more
      // speed on the wire at a stopped belt.
      const { d, writes } = speedPad();
      driver.value = d;

      const p = doStart();
      await settle();
      await p;
      ingest({ speedKmh: 1.0 }); // no state label: this pad has none to give
      await upToSpeed();
      expect(writes).toEqual([TARGET]);

      ingest({ speedKmh: 0 });
      await vi.advanceTimersByTimeAsync(3000);

      expect(writes).toEqual([TARGET]);
    });

    it('says nothing about a write that failed because the link went', async () => {
      // The disconnect has already put the one message worth reading on the chip.
      // A raw GATT error from the write it killed on the way out replaces it with
      // something nobody can act on.
      const track = vi.fn();
      setAnalyticsProvider({ track });
      const { d } = speedPad({
        setSpeed: async () => {
          await disconnect();
          throw new Error('GATT operation failed for unknown reason');
        },
      });
      driver.value = d;

      const p = doStart();
      await settle();
      await p;
      crawls();
      await upToSpeed();

      expect(status.value.text).not.toMatch(/GATT/);
      expect(track).not.toHaveBeenCalledWith('control_failed', expect.anything());
    });

    it('records a setpoint that only landed on the second write', async () => {
      // The population this whole read-back exists for, and the one a "gave up after
      // three" event cannot show: pads that do get there, but not first time.
      const track = vi.fn();
      setAnalyticsProvider({ track });
      const { d } = speedPad();
      driver.value = d;

      const p = doStart();
      await settle();
      await p;
      crawls();
      await upToSpeed();
      await vi.advanceTimersByTimeAsync(3000); // the first write is dropped; a second goes
      ingest({ speedKmh: TARGET }); // and this one lands
      await vi.advanceTimersByTimeAsync(500);

      expect(track).toHaveBeenCalledWith('start_speed_rewritten', {
        attempts: 2,
        applied: true,
      });
    });

    it('records a setpoint the belt never took', async () => {
      const track = vi.fn();
      setAnalyticsProvider({ track });
      const { d } = speedPad();
      driver.value = d;

      const p = doStart();
      await settle();
      await p;
      crawls();
      await vi.advanceTimersByTimeAsync(12_000);

      expect(track).toHaveBeenCalledWith('start_speed_rewritten', {
        attempts: 3,
        applied: false,
      });
    });

    it('records nothing when the belt takes the setpoint first time', async () => {
      const track = vi.fn();
      setAnalyticsProvider({ track });
      const { d } = speedPad();
      driver.value = d;

      const p = doStart();
      await settle();
      await p;
      crawls();
      await upToSpeed();
      ingest({ speedKmh: TARGET });
      await vi.advanceTimersByTimeAsync(3000);

      expect(track).not.toHaveBeenCalledWith('start_speed_rewritten', expect.anything());
    });

    it('abandons the job when the belt stops itself', async () => {
      const { d, writes } = speedPad();
      driver.value = d;

      const p = doStart();
      await settle();
      await p;
      crawls();
      await upToSpeed();

      ingest({ speedKmh: 0, state: 5, stateLabel: 'stopped' });
      await vi.advanceTimersByTimeAsync(8000);

      expect(writes).toEqual([TARGET]);
      expect(running.value).toBe(false);
    });
  });
});
