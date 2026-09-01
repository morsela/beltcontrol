import { signal, computed, effect } from '@preact/signals';
import { detectDriver, UUID } from '../lib/drivers.js';
import type { Driver, StartVerdict } from '../lib/drivers.js';
import {
  ingest,
  resetTelemetry,
  live,
  isMoving,
  confirmedStopped,
  confirmedRunning,
  beltReportsRest,
  lastFrameAt,
} from './telemetry.js';
import { log, setStatus, fail } from './log.js';
import { trackEvent } from '../lib/analytics.js';
import { settings, updateSettings } from './settings.js';
import { openDialogs } from './ui.js';
import { toMph, toKmh, MPH_STEP } from '../lib/format.js';
import {
  setSessionMeta,
  startSessionTracking,
  stopSessionTracking,
  closeSession,
  holdSession,
  restoreOpenSession,
} from './session.js';

// Coarse name prefixes covering all 114 treadmill/walking-pad `leach_word` values in the
// KS+Fit product catalog (assets/mine/allProducts.json).
const NAME_PREFIXES = [
  'KS-',
  'KingSmith',
  'WalkingPad',
  'R1 Pro',
  'RE',
  'RH',
  'FS-',
  'FT216',
  'Gymnas',
  'ZP-',
];

// Every service the page may touch must be declared up front or Web Bluetooth blocks access.
const OPTIONAL_SERVICES = [
  UUID.classicService,
  UUID.ftmsService,
  UUID.ks1234Service,
  UUID.fitshowService,
  UUID.deviceInfo,
  UUID.battery,
];

/** The belt moves off at its own fixed low speed the instant `start` lands, whatever
 *  target was asked for, and some units ignore a `setSpeed` sent before it is actually
 *  moving — confirmed on real hardware. So `doStart` waits this long before setting the
 *  speed the user chose. */
const SPEED_SETTLE_MS = 600;

export type Phase = 'idle' | 'choosing' | 'connecting' | 'connected' | 'error';

export const phase = signal<Phase>('idle');
export const driver = signal<Driver | null>(null);
export const deviceName = signal<string | null>(null);
export const running = signal(false);
export const supported = signal(true);
/** The belt is stopped, but the walk is not over: `start()` picks it back up. */
export const paused = signal(false);

let device: BluetoothDevice | null = null;
let pollTimer: number | null = null;

/** Cleared the first time a unit answers a pause with "op code not supported". The
 *  protocol carries the command; this particular treadmill does not, and there is no
 *  feature bit to ask beforehand, so the button goes away once we know. */
const pauseAccepted = signal(true);

export const connected = computed(() => phase.value === 'connected');
export const targetKmh = computed(() => settings.value.targetKmh);

/**
 * Whether the belt may be moving, and so whether Stop belongs on screen.
 *
 * `running` as well as `isMoving`: between the start write and the pad's first frame the
 * belt is spinning up with nothing in telemetry yet, and Stop has to be reachable for
 * that window. It used to be covered by faking a speed reading, which also kept Stop
 * pinned forever when the pad ignored the start. Both flags now fall when the belt says
 * it is at rest — including when it stopped itself, which is the common case.
 *
 * One computed rather than the same expression written three ways, because a screen
 * that shows Stop over a stopped belt and a screen that hides it over a moving one are
 * the same bug.
 */
export const beltMayBeMoving = computed(
  () => connected.value && (isMoving.value || running.value)
);

/** Only ever true where pause is a real, resumable pause on the wire. */
export const canPause = computed(
  () => connected.value && (driver.value?.capabilities.pause ?? false) && pauseAccepted.value
);

/** Belt state for the status chip. Always paired with a text label in the UI —
 *  warn and bad are only dE 5.7 apart under deuteranopia, so colour alone would
 *  be unreadable for a chunk of users. */
export type BeltTone = 'good' | 'warn' | 'bad' | 'idle';

export const beltTone = computed<BeltTone>(() => {
  if (phase.value === 'error') return 'bad';
  if (phase.value === 'choosing' || phase.value === 'connecting') return 'warn';
  if (phase.value !== 'connected') return 'idle';
  if ((live.value.speedKmh ?? 0) > 0.05) return 'good';
  // Paused is held, not idle: something is still owed a decision.
  return paused.value ? 'warn' : 'idle';
});

export const beltLabel = computed(() => {
  switch (phase.value) {
    case 'idle':
      return 'Not connected';
    case 'choosing':
      return 'Choosing device';
    case 'connecting':
      return 'Connecting';
    case 'error':
      return 'Error';
    default:
      break;
  }
  const d = live.value;
  if ((d.speedKmh ?? 0) > 0.05) return 'Running';
  if (paused.value) return 'Paused';
  return d.stateLabel ? capitalise(d.stateLabel) : 'Connected';
});

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The error *name* only — a DOMException message can quote the device's advertised
 *  name, and analytics carries nothing identifying. */
const errName = (e: unknown) => (e instanceof Error && e.name ? e.name : 'Error');

// --- connection ------------------------------------------------------------

/**
 * `name` narrows the chooser to one exact advertised name — the Reconnect path. The
 * chooser still opens: Web Bluetooth grants nothing without a gesture through it, so
 * "reconnect" is honestly "the same chooser, pre-filtered to the pad you had".
 */
export async function connect({ filtered, name }: { filtered: boolean; name?: string }) {
  // One attempt at a time. The chooser is a browser dialog and the button behind it stays
  // on screen and clickable, so a double press — or an impatient second one while the
  // GATT handshake is running — used to start a whole second attempt. Both then wrote to
  // the same phase, and the loser finished last: backing out of one chooser reset the
  // phase to `idle` underneath the attempt that was still connecting, leaving the app
  // reporting "Not connected" over a live handshake.
  if (phase.value === 'choosing' || phase.value === 'connecting') {
    log('already connecting — ignoring a second attempt');
    return;
  }

  if (!navigator.bluetooth) {
    fail(
      new Error(
        'This browser has no Web Bluetooth. Use Chrome, Edge, Opera or Samsung Internet — ' +
          'Firefox and Safari (including on iOS) do not implement it.'
      )
    );
    return;
  }

  // Device selection is its own step: requestDevice throws NotFoundError when the user
  // cancels, but so does getCharacteristic when a UUID is missing. Catching them together
  // reports real GATT failures as "chooser cancelled" and hides the actual fault.
  let picked: BluetoothDevice;
  trackEvent('connect_attempted', { filtered });
  try {
    phase.value = 'choosing';
    setStatus('choosing device…');
    const options: RequestDeviceOptions = name
      ? { filters: [{ name }], optionalServices: OPTIONAL_SERVICES }
      : filtered
        ? {
            filters: NAME_PREFIXES.map((namePrefix) => ({ namePrefix })),
            optionalServices: OPTIONAL_SERVICES,
          }
        : { acceptAllDevices: true, optionalServices: OPTIONAL_SERVICES };
    picked = await navigator.bluetooth.requestDevice(options);
  } catch (e) {
    const err = e as DOMException;
    phase.value = 'idle';
    // Backing out of the chooser is not a failure — the chip returns to "Not
    // connected" beside a Connect button, which says everything there is to say.
    // Only a real chooser fault is worth putting on screen.
    if (err?.name === 'NotFoundError') {
      setStatus('');
      log('device chooser cancelled or nothing matched');
      trackEvent('connect_cancelled');
    } else {
      setStatus(err.message, 'err');
      log(err.message);
      trackEvent('connect_failed', { reason: errName(err) });
    }
    return;
  }

  try {
    device = picked;
    log(`selected "${picked.name ?? '(unnamed)'}" id=${picked.id}`);
    picked.addEventListener('gattserverdisconnected', onDisconnected);

    phase.value = 'connecting';
    setStatus('connecting…');
    const server = await picked.gatt!.connect();

    setStatus('detecting protocol…');
    const d = await detectDriver(server);
    if (!d) {
      throw new Error(
        'No known treadmill service on this device — looked for fe00 (classic), ' +
          '1826 (FTMS), 1234 (KingSmith chip:3) and fff0 (FitShow).'
      );
    }

    await wireDriver(d, server, picked.name ?? null);

    // Only after the whole handshake: a name remembered from a connect that failed
    // protocol detection would offer back a pad the app cannot drive. Stored even
    // when null — the truth about the last pad beats a stale name for a different one.
    updateSettings({ lastDeviceName: picked.name ?? null });
  } catch (e) {
    // Anything from here on is a GATT/protocol failure, not a cancelled chooser.
    const err = e as DOMException;
    phase.value = 'error';
    fail(err?.name === 'NotFoundError' ? new Error(`GATT lookup failed: ${err.message}`) : e);
    trackEvent('connect_failed', { reason: errName(err) });
    await teardown();
  }
}

/** Everything that happens once a driver has been identified, real or simulated. */
async function wireDriver(
  d: Driver,
  server: BluetoothRemoteGATTServer | null,
  name: string | null,
  simulated = false
) {
  d.onLog = (m) => log(m);
  d.onData = (patch) => ingest(patch);

  paused.value = false;
  pauseAccepted.value = true; // a rejection belongs to the unit, not to the next one
  driver.value = d;
  deviceName.value = name ?? '(unnamed)';
  log(`protocol: ${d.name}`, 'ok');

  await d.attach(server as BluetoothRemoteGATTServer);

  // Clamp the speed control to what this unit actually accepts.
  updateSettings({
    targetKmh: Math.min(Math.max(settings.value.targetKmh, d.minSpeedKmh), d.maxSpeedKmh),
  });

  setSessionMeta({ protocol: d.id, protocolName: d.name, deviceName: name });

  phase.value = 'connected';
  setStatus('connected', 'ok');
  trackEvent('belt_connected', { protocol: d.id, simulated });

  restoreOpenSession();
  startSessionTracking();

  if (d.capabilities.needsPolling) startPolling();
}

/**
 * Attach a fake pad so the UI can be exercised without hardware.
 *
 * No longer dev-only: the connect panel offers it as a walkthrough to first-time
 * visitors and to browsers with no Web Bluetooth at all, where it is the only way to
 * see the app do anything. The dynamic import keeps the simulator out of the main
 * bundle either way, and nothing about the connection pretends: the chip names the
 * device "Simulated …", every session it records carries that name, and analytics
 * carries a `simulated` flag so demo connections never count as pads in the field.
 * `lastDeviceName` is untouched — Reconnect only ever names a real pad.
 */
export async function connectSimulated(
  id?: 'classic' | 'ftms' | 'ks1234' | 'fitshow',
  opts: { rejectPause?: boolean; refuseStarts?: number } = {}
) {
  const { simulatedDriver } = await import('../lib/simulator.js');
  await wireDriver(simulatedDriver({ id, ...opts }), null, `Simulated ${id ?? 'classic'}`, true);
}

function startPolling() {
  stopPolling();
  pollTimer = window.setInterval(() => {
    driver.value?.poll().catch((e: Error) => log(`poll failed: ${e.message}`, 'err'));
  }, 1000);
}

function stopPolling() {
  if (pollTimer != null) window.clearInterval(pollTimer);
  pollTimer = null;
}

async function teardown() {
  stopPolling();
  clearStopWatch();
  clearStartWatch();
  stopSessionTracking();
  closeSession('ended (disconnected)');
  try {
    await driver.value?.detach();
  } catch {
    /* device already gone */
  }
  driver.value = null;
  running.value = false;
  paused.value = false;
  stopPending.value = false;
  resetTelemetry();
  if (phase.value !== 'error') phase.value = 'idle';
}

function onDisconnected() {
  // Deliberately no auto-reconnect: silently reattaching to a belt that may be moving,
  // with stale UI state, is not a safe default.
  trackEvent('disconnected', { by: 'device' });
  log('device disconnected', 'err');
  setStatus('disconnected — belt keeps its current state, use its own controls', 'err');
  phase.value = 'error';
  void teardown();
}

export async function disconnect() {
  try {
    await driver.value?.detach();
  } catch {
    /* ignore */
  }
  device?.removeEventListener('gattserverdisconnected', onDisconnected);
  if (device?.gatt?.connected) device.gatt.disconnect();
  device = null;
  deviceName.value = null;
  phase.value = 'idle';
  await teardown();
  setStatus('disconnected');
  log('disconnected');
  trackEvent('disconnected', { by: 'user' });
}

// --- controls --------------------------------------------------------------

export const doStart = () => begin('start');
export const doResume = () => begin('resume');

/**
 * Set the belt going, from a standstill or from a pause.
 *
 * One function because it is one command on the wire — FTMS spends a single op code on
 * "Start or Resume".
 *
 * Confirmation lives in the UI (see `Now`), not here: a `window.confirm` in the middle of
 * the control path blocks the event loop and takes Escape away from the app at the one
 * moment Escape has somewhere better to be. Both callers owe the user that dialog — a
 * resume moves a belt exactly as much as a start does.
 */
async function begin(kind: 'start' | 'resume') {
  const d = driver.value;
  if (!d) return;

  const mph = toMph(settings.value.targetKmh).toFixed(1);

  // A start supersedes any stop or pause still waiting to be confirmed.
  clearStopWatch();
  stopPending.value = false;

  // Raised for the whole sequence, retries included, rather than left to `watchForStart`
  // at the end of it. A refused start is a belt sitting there reporting zero, and with
  // `running` up and this flag down that is precisely the shape the self-stop watcher
  // reads as "the belt stopped by itself" — it would file the walk mid-retry.
  const gen = ++startGeneration;
  startPending.value = true;

  let verdict: StartVerdict = 'unknown';

  for (let attempt = 1; attempt <= MAX_START_ATTEMPTS; attempt++) {
    // Refreshed per attempt: only what the belt says after the latest command counts as
    // its answer to that command.
    askedToMoveAt = Date.now();

    try {
      setStatus(kind === 'resume' ? 'resuming…' : 'starting…');
      await d.start();
    } catch (e) {
      // The command never went out, so the belt is where it was — including still paused,
      // if that is where it was.
      clearStartWatch();
      running.value = false;
      trackEvent('control_failed', { command: kind, reason: errName(e) });
      fail(e);
      return;
    }
    if (startGeneration !== gen) return;

    // `running` means "a start is outstanding, so the belt may be moving" from here on,
    // which is what keeps Stop pinned and reachable. It is not a claim that the belt
    // obeyed — the verdict below and then `watchForStart` decide that, in that order.
    // `paused` drops for the same reason in reverse: a Resume button in front of a belt
    // that was just told to go is wrong even if it turns out not to have gone.
    //
    // Up from the first attempt and never lowered between them: a pad that answered no
    // is still a pad that might act on the command late, and Stop has to stay in reach
    // for every second of that.
    running.value = true;
    paused.value = false;
    holdSession(false);
    if (attempt === 1) {
      log(`${kind} sent at ${mph} mph (${settings.value.targetKmh.toFixed(1)} km/h)`, 'ok');
      // Once per press, not per retry: the retries are the app's doing, and counting
      // them as starts would inflate exactly the number the refusal events divide by.
      trackEvent('belt_start', { kind });
    }

    // `unknown` on every protocol that cannot answer, which is all of them but one, so
    // this loop runs exactly once and behaves as it always did unless a pad says no.
    verdict = (await d.startVerdict?.()) ?? 'unknown';
    if (startGeneration !== gen) return;
    if (verdict !== 'refused') break;

    // The refusal is the pad's account of the command, not of the belt. If the belt is
    // moving regardless, that outranks it — and re-sending a start to a belt already
    // under way is the one retry with nothing to gain and a person standing on it.
    if (confirmedRunning.value) break;
    if (attempt === MAX_START_ATTEMPTS) break;

    log(
      `the belt refused the ${kind} — sending it again ` +
        `(attempt ${attempt + 1} of ${MAX_START_ATTEMPTS})`,
      'err'
    );
    await new Promise((r) => setTimeout(r, START_RETRY_MS));
    if (startGeneration !== gen) return;
  }

  watchForStart(kind, verdict === 'refused');

  try {
    // Some units ignore a speed set before the belt is actually moving.
    await new Promise((r) => setTimeout(r, SPEED_SETTLE_MS));
    if (d.capabilities.speed) await d.setSpeed(settings.value.targetKmh);
  } catch (e) {
    // A failed speed write says nothing about whether the belt started, so `running`
    // and the confirmation watch both stand. Report it and let the watch play out.
    trackEvent('control_failed', { command: 'speed', reason: errName(e) });
    fail(e);
  }
}

/** How long to wait for the belt to report movement before saying it never confirmed.
 *  A pad that accepts a start reports `runState 1` within a few seconds; one that has
 *  quietly refused says nothing at all, ever. */
const START_CONFIRM_MS = 10_000;

/**
 * How many times a start the pad answered with a flat refusal is worth writing again.
 *
 * Three, because three is what the KS-C2 that prompted this took: two refusals, then an
 * identical third attempt the pad simply accepted. Nothing in the protocol explains what
 * changed between them, and that is exactly why this is a small cap and not persistence —
 * a pad that keeps refusing is telling the truth about itself, and hammering a treadmill
 * with start commands until one lands is not a thing this app does.
 */
const MAX_START_ATTEMPTS = 3;

/** Breathing room between a refusal and the next attempt. */
const START_RETRY_MS = 800;

/** A start has been written and the belt has not confirmed it yet. */
export const startPending = signal(false);

let startWatch: number | null = null;

/**
 * Bumped by everything that ends a start's life: a stop, a pause, a disconnect, or another
 * start. `begin` takes a copy and re-checks it after every await, which is how a retry
 * sequence nobody wants any more stops between attempts instead of putting one more start
 * on the wire behind the back of whoever just pressed Stop.
 */
let startGeneration = 0;

/** Drop the confirmation timer without touching `startPending`. Re-arming the watch has
 *  to leave the flag alone: the self-stop watcher reads it, and a single blink off is all
 *  that watcher needs to file a start that is still perfectly alive. */
function stopStartTimer() {
  if (startWatch != null) window.clearInterval(startWatch);
  startWatch = null;
}

function clearStartWatch() {
  startGeneration++;
  stopStartTimer();
  startPending.value = false;
}

/**
 * The mirror of `watchForStop`, and it exists for the same reason: a resolved `start()`
 * means the command was written, not that the belt obeyed it.
 *
 * This used to be papered over by injecting a fabricated `speedKmh` into telemetry the
 * moment the write resolved. That made the app's own guess indistinguishable from the
 * belt's report, so a pad that silently refused a start still drove the whole UI —
 * Stop pinned over a stationary belt, no way back to Start, and a later stop that could
 * never confirm because the "speed" it was waiting to see fall to zero was the app's
 * invention. So: assert nothing, wait for the pad, and say so when it never answers.
 */
function watchForStart(kind: 'start' | 'resume' = 'start', refused = false) {
  stopStartTimer();
  startPending.value = true;
  const deadline = Date.now() + START_CONFIRM_MS;

  const check = () => {
    if (confirmedRunning.value) {
      clearStartWatch();
      setStatus('running', 'ok');
      log('belt reports movement — running', 'ok');
      return;
    }
    if (Date.now() >= deadline) {
      clearStartWatch();
      // Unlike an unconfirmed stop, this clears `running`: the evidence is that the
      // belt never moved, so leaving the UI pinned to Stop strands the user on a
      // control for a state the belt is not in.
      running.value = false;
      // A resume that the belt ignored leaves the walk exactly where it was — still
      // paused, still held open — so put Resume back rather than quietly filing it.
      if (kind === 'resume') {
        paused.value = true;
        holdSession(true);
      }
      // Phrased like the unconfirmed-stop message beside it: what was sent, what the
      // belt did about it, what to do next. The chip carries this now, and wraps.
      //
      // A pad that refused out loud gets told back what it said, rather than the softer
      // "never reported movement" — it did not fail to answer, it answered no, and every
      // retry it had was spent. Saying so is what points at the panel as the thing to fix.
      //
      // And when the pad has said its child lock is on, point there instead: the
      // vendor's own advice for this exact error checks the lock before anything else.
      // It stays a hint, not a diagnosis — a locked pad refusing starts is KS+Fit's
      // reading, not something yet observed on the wire — but it is the one message
      // here that ends in a switch the user can actually flip.
      const lock = driver.value?.childLockOn === true;
      setStatus(
        refused
          ? lock
            ? `${capitalise(kind)} was sent ${MAX_START_ATTEMPTS} times and the belt refused ` +
                'each one — and the pad reports its child lock is on. Unlock it from the ' +
                'panel, then try again.'
            : `${capitalise(kind)} was sent ${MAX_START_ATTEMPTS} times and the belt refused ` +
                "each one — its own panel still has control. Use the treadmill's own " +
                'controls, or disconnect and reconnect.'
          : `${capitalise(kind)} was sent but the belt never reported movement — it may ` +
              "have handed control back to its own panel. Use the treadmill's own " +
              'controls, or disconnect and reconnect.',
        'err'
      );
      log(
        refused
          ? `${kind} refused ${MAX_START_ATTEMPTS} times — the belt never moved` +
              (lock ? " (the pad's child lock is on)" : '')
          : `${kind} unconfirmed after ${START_CONFIRM_MS / 1000}s — the belt never moved`,
        'err'
      );
      trackEvent('start_unconfirmed', { kind, refused, childLock: lock });
    }
  };

  check(); // a pad already reporting movement confirms immediately
  if (startWatch != null || confirmedRunning.value) return;
  startWatch = window.setInterval(check, 250);
}

/** How long to wait for the belt to report zero before saying it never confirmed.
 *  A pad decelerating from walking speed reports zero within a second or two. */
const STOP_CONFIRM_MS = 6_000;

/**
 * A stop has been written and the belt has not reported zero since.
 *
 * `running` stays true through an unconfirmed stop — the belt may still be moving —
 * which on its own is indistinguishable from a start whose movement has not shown up
 * in telemetry yet. `Now` tells the two apart with this, so a pending stop is never
 * described as a pending start. Stays true past the confirmation deadline: the stop
 * really is still outstanding.
 */
export const stopPending = signal(false);

let stopWatch: number | null = null;

function clearStopWatch() {
  if (stopWatch != null) window.clearInterval(stopWatch);
  stopWatch = null;
}

/**
 * A resolved `stop()` or `pause()` means the command was written, not that the belt
 * obeyed it. Only two of the four protocols can even acknowledge one — FTMS via its
 * control point, and nothing else — so the belt's own telemetry is the only evidence
 * that applies to every pad. Report the outcome when it reports zero, and say plainly
 * when it never does, rather than asserting something the app has not observed.
 *
 * A pause is held to the same standard, and `paused` is set from here rather than from
 * `doPause` for that reason: until the belt says zero, the app has a written command and
 * nothing more. It also makes the flag mean something exact downstream — the belt has
 * been seen at rest — so movement afterwards really is somebody starting it again, not
 * the tail of the deceleration.
 */
function watchForStop(kind: 'stop' | 'pause' = 'stop') {
  clearStopWatch();
  stopPending.value = true;
  const deadline = Date.now() + STOP_CONFIRM_MS;
  const done = kind === 'pause' ? 'paused' : 'stopped';

  const check = () => {
    if (confirmedStopped.value) {
      clearStopWatch();
      running.value = false;
      stopPending.value = false;
      if (kind === 'pause') {
        paused.value = true;
        holdSession(true);
      }
      setStatus(done, 'ok');
      log(`belt reports zero — ${done}`, 'ok');
      return;
    }
    if (Date.now() >= deadline) {
      clearStopWatch();
      // Deliberately leaves `running` true: the belt has not said it stopped, so the
      // UI should keep treating it as a belt that might be moving. For a pause that
      // also means `paused` is never set — no Resume button in front of a moving belt.
      const s = live.value.speedKmh;
      const why =
        s == null
          ? 'it is not reporting speed at all'
          : `it still reports ${toMph(s).toFixed(1)} mph`;
      setStatus(
        `${kind === 'pause' ? 'Pause' : 'Stop'} was sent but the belt has not confirmed — ` +
          `${why}. Use the treadmill's own controls.`,
        'err'
      );
      log(`${kind} unconfirmed after ${STOP_CONFIRM_MS / 1000}s — ${why}`, 'err');
      trackEvent('stop_unconfirmed', { kind });
    }
  };

  check(); // a pad already reporting zero confirms immediately
  if (stopWatch == null && !confirmedStopped.value) {
    // Say what is being waited on. "stopping…" reads as an assertion about the belt;
    // this reads as an assertion about the app, which is all that is known yet.
    setStatus(`${kind} sent — waiting for the belt to report zero`);
    stopWatch = window.setInterval(check, 250);
  }
}

/**
 * Pause the belt, keeping the walk and the speed setpoint.
 *
 * The driver reports what the unit actually did with the command; the watcher above
 * reports what the belt actually did about it. A treadmill that cannot pause gets
 * stopped instead and loses the button for the rest of the connection.
 */
export async function doPause() {
  const d = driver.value;
  if (!d) return;
  try {
    clearStartWatch(); // a pause supersedes any start still waiting to be confirmed
    setStatus('pausing…');
    const outcome = await d.pause();

    if (outcome === 'stopped') {
      pauseAccepted.value = false;
      paused.value = false;
      holdSession(false);
      log('unit rejected pause; stopped instead — hiding the button', 'err');
      setStatus('this treadmill has no pause — belt stopped instead', 'err');
      trackEvent('pause_rejected');
      watchForStop('stop');
      return;
    }

    log(`pause sent at ${toMph(settings.value.targetKmh).toFixed(1)} mph`, 'ok');
    trackEvent('belt_pause');
    watchForStop('pause');
  } catch (e) {
    clearStopWatch();
    stopPending.value = false;
    trackEvent('control_failed', { command: 'pause', reason: errName(e) });
    fail(e);
  }
}

export async function doStop() {
  const d = driver.value;
  if (!d) return;
  try {
    clearStartWatch(); // a stop supersedes any start still waiting to be confirmed
    setStatus('stopping…');
    await d.stop();
    // Stop ends the walk, so the pause hold goes with it — pausing and then stopping
    // should let the session close on the ordinary idle rule, not sit open for 15 minutes.
    paused.value = false;
    holdSession(false);
    log('stop sent', 'ok');
    trackEvent('belt_stop');
    watchForStop();
  } catch (e) {
    clearStopWatch();
    stopPending.value = false; // nothing went out, so nothing is outstanding
    trackEvent('control_failed', { command: 'stop', reason: errName(e) });
    fail(e);
  }
}

/** How long the belt must sit at zero, with nothing outstanding, before a pad that
 *  reports no state code at all is taken as stopped. Long enough not to trip on the gap
 *  between a confirmed `runState 1` and the first frame carrying any speed. */
const SELF_STOP_MS = 3_000;

/** When the app last asked the belt to move. */
let askedToMoveAt = 0;

/**
 * The belt stops itself more often than anyone stops it from here: nobody steps on
 * inside its safety window, the key is pulled, its own panel is used. No command comes
 * back to the app when that happens — the frames simply start reading zero — so nothing
 * used to clear `running`, and Stop stayed pinned over a stationary belt for the rest of
 * the connection with no way back to Start.
 *
 * Guarded on both pending flags rather than on telemetry alone. A start that has not
 * been confirmed yet is a belt legitimately reporting zero, and an outstanding stop is
 * `watchForStop`'s business — it clears `running` itself, and with the right words for
 * a stop somebody asked for.
 *
 * And guarded on the age of the frame, which is the guard the other two cannot stand in
 * for: a pad sitting idle reports `stopped` right up until the moment a start is written,
 * and that last frame is still the newest one when `running` goes up. Read as evidence it
 * would cancel every start on arrival. Only what the belt has said *since* being asked to
 * move counts.
 */
effect(() => {
  if (!running.value || startPending.value || stopPending.value) return;
  if ((lastFrameAt.value ?? 0) <= askedToMoveAt) return;
  if (!confirmedStopped.value) return;

  // A named resting state is the pad saying it outright, so it is taken at once. Bare
  // zero speed is the same claim from a protocol that cannot name states, and gets the
  // grace period instead.
  if (beltReportsRest.value) {
    selfStopped();
    return;
  }
  const t = setTimeout(selfStopped, SELF_STOP_MS);
  return () => clearTimeout(t);
});

function selfStopped() {
  if (!running.value) return;
  running.value = false;
  // Not a pause: nothing is coming back on its own, and `paused` would put a Resume
  // button in front of a belt nobody paused.
  setStatus('the belt stopped on its own', 'ok');
  log('belt reports itself stopped — nobody sent a stop', 'ok');
  trackEvent('belt_self_stopped');
}

/** File the paused walk now rather than waiting for the hold to lapse. */
export function endWalk() {
  paused.value = false;
  holdSession(false);
  closeSession('ended');
}

// The belt can also be restarted from its own remote or handrail, and then the app is not
// paused whatever the button last said. This needs no grace period for the deceleration:
// `paused` is only ever set once the belt has confirmed zero, so anything moving after
// that is somebody starting it, not the tail of the ramp down.
effect(() => {
  if (paused.value && isMoving.value) {
    paused.value = false;
    holdSession(false);
  }
});

/** Set an absolute target, clamped to the unit's real range. */
export async function setTarget(kmh: number) {
  const d = driver.value;
  if (!d) return;
  const next = Math.min(Math.max(Math.round(kmh * 10) / 10, d.minSpeedKmh), d.maxSpeedKmh);
  const prev = settings.value.targetKmh;
  if (next === prev) return;

  // Move the readout first so a stepper press never feels dead, then put it back if
  // the write does not land. The alternative — waiting for the device before showing
  // anything — loses presses when someone taps + three times in a row. What is not
  // acceptable is the middle ground the app used to sit in: a target left on screen
  // that the belt never received, with the failure only in the protocol log.
  updateSettings({ targetKmh: next });
  if (!running.value) return; // just move the setpoint while stopped
  try {
    await d.setSpeed(next);
    log(`speed → ${toMph(next).toFixed(1)} mph (${next.toFixed(1)} km/h)`);
    // Clears any error still showing from an earlier failed write.
    setStatus(`speed ${toMph(next).toFixed(1)} mph`, 'ok');
  } catch (e) {
    updateSettings({ targetKmh: prev });
    trackEvent('control_failed', { command: 'speed', reason: errName(e) });
    fail(e);
  }
}

export async function nudgeSpeed(delta: 1 | -1) {
  const d = driver.value;
  if (!d) return;
  const current = settings.value.targetKmh;
  // Step in whole mph increments so the displayed number moves cleanly, then convert back.
  // 0.2 mph is 0.32 km/h, comfortably inside the 0.5 km/h-per-press safety limit.
  const targetMph = Math.round((toMph(current) + delta * MPH_STEP) * 10) / 10;
  let next = Math.round(toKmh(targetMph) * 10) / 10;

  // Rounding to the wire's 0.1 km/h resolution can land back on the current value; if so,
  // fall back to one device step so the button never feels dead.
  if (next === current) next = current + delta * Math.max(d.speedStep, 0.1);

  await setTarget(next);
}

export async function setMode(mode: number) {
  try {
    await driver.value?.setMode(mode);
    log(`mode → ${['auto', 'manual', 'standby'][mode]}`);
  } catch (e) {
    fail(e);
  }
}

// --- global guards ---------------------------------------------------------

export function installGuards() {
  // Stop is the one control that must always be reachable.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !driver.value) return;
    // While a dialog is open Escape belongs to it — dismissing a sheet should not
    // also halt the walk. Safe because every dialog renders its own Stop while the
    // belt is moving, so the control never leaves the screen. See state/ui.ts.
    if (openDialogs.value > 0) return;
    void doStop();
  });

  // Leaving the page does not stop the belt — say so rather than let it surprise anyone.
  window.addEventListener('beforeunload', (e) => {
    if (running.value) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  if (!navigator.bluetooth) {
    supported.value = false;
    setStatus(
      'Web Bluetooth unavailable — use Chrome, Edge, Opera or Samsung Internet over HTTPS or localhost',
      'err'
    );
  } else if (!window.isSecureContext) {
    setStatus('Not a secure context — serve over https:// or http://localhost', 'err');
  }
}
