import { signal, computed, effect } from '@preact/signals';
import { detectDriver, UUID } from '../lib/drivers.js';
import type { Driver } from '../lib/drivers.js';
import { ingest, resetTelemetry, live, isMoving } from './telemetry.js';
import { log, setStatus, fail } from './log.js';
import { settings, updateSettings } from './settings.js';
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

/** The belt moves off at this speed the instant `start` lands, regardless of the
 *  requested target — confirmed on real hardware. `setSpeed` only takes effect once
 *  the belt is already moving, hence the delay in `doStart`. */
const START_SPEED_MPH = 0.6;

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

// --- connection ------------------------------------------------------------

export async function connect({ filtered }: { filtered: boolean }) {
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
  try {
    phase.value = 'choosing';
    setStatus('choosing device…');
    const options: RequestDeviceOptions = filtered
      ? {
          filters: NAME_PREFIXES.map((namePrefix) => ({ namePrefix })),
          optionalServices: OPTIONAL_SERVICES,
        }
      : { acceptAllDevices: true, optionalServices: OPTIONAL_SERVICES };
    picked = await navigator.bluetooth.requestDevice(options);
  } catch (e) {
    const err = e as DOMException;
    phase.value = 'idle';
    setStatus(err?.name === 'NotFoundError' ? 'no device selected' : err.message, 'err');
    log(err?.name === 'NotFoundError' ? 'device chooser cancelled or nothing matched' : err.message);
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
  } catch (e) {
    // Anything from here on is a GATT/protocol failure, not a cancelled chooser.
    const err = e as DOMException;
    phase.value = 'error';
    fail(err?.name === 'NotFoundError' ? new Error(`GATT lookup failed: ${err.message}`) : e);
    await teardown();
  }
}

/** Everything that happens once a driver has been identified, real or simulated. */
async function wireDriver(
  d: Driver,
  server: BluetoothRemoteGATTServer | null,
  name: string | null
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

  restoreOpenSession();
  startSessionTracking();

  if (d.capabilities.needsPolling) startPolling();
}

/**
 * Development only: attach a fake pad so the UI can be exercised without hardware.
 * `import.meta.env.DEV` is statically false in a production build, so both this and
 * the simulator module are dropped by the bundler.
 */
export async function connectSimulated(
  id?: 'classic' | 'ftms' | 'ks1234' | 'fitshow',
  opts: { rejectPause?: boolean } = {}
) {
  if (!import.meta.env.DEV) return;
  const { simulatedDriver } = await import('../lib/simulator.js');
  await wireDriver(simulatedDriver({ id, ...opts }), null, `Simulated ${id ?? 'classic'}`);
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
  resetTelemetry();
  if (phase.value !== 'error') phase.value = 'idle';
}

function onDisconnected() {
  // Deliberately no auto-reconnect: silently reattaching to a belt that may be moving,
  // with stale UI state, is not a safe default.
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
}

// --- controls --------------------------------------------------------------

export const doStart = () => begin('start');
export const doResume = () => begin('resume');

/**
 * Set the belt going, from a standstill or from a pause.
 *
 * One function because it is one command on the wire — FTMS spends a single op code on
 * "Start or Resume" — and because resuming deserves the same confirmation as starting:
 * either way a belt is about to move, and it may not be the person who paused it
 * standing on it now.
 */
async function begin(kind: 'start' | 'resume') {
  const d = driver.value;
  if (!d) return;

  const mph = toMph(settings.value.targetKmh).toFixed(1);
  const ok = confirm(
    `${kind === 'resume' ? 'Resume' : 'Start'} the belt at ${mph} mph?\n\n` +
      'Make sure the belt is clear and you are ready.'
  );
  if (!ok) return;

  try {
    setStatus(kind === 'resume' ? 'resuming…' : 'starting…');
    await d.start();
    running.value = true;
    paused.value = false;
    holdSession(false);
    // A cold start moves off at the pad's own floor speed whatever we asked for, so the
    // UI would show a stale reading for up to a second without this. A resume comes back
    // at the speed it was paused at, so it needs no such guess.
    if (kind === 'start') ingest({ speedKmh: toKmh(START_SPEED_MPH) });
    // Some units ignore a speed set before the belt is actually moving.
    await new Promise((r) => setTimeout(r, 600));
    if (d.capabilities.speed) await d.setSpeed(settings.value.targetKmh);
    setStatus('running', 'ok');
    log(
      `${kind === 'resume' ? 'resumed' : 'started'} at ${mph} mph ` +
        `(${settings.value.targetKmh.toFixed(1)} km/h)`,
      'ok'
    );
  } catch (e) {
    fail(e);
  }
}

/**
 * Pause the belt, keeping the walk and the speed setpoint.
 *
 * The driver reports back what the unit actually did. A treadmill that cannot pause gets
 * stopped instead and loses the button for the rest of the connection — the one thing
 * this must never do is report a pause to a belt that is still moving.
 */
export async function doPause() {
  const d = driver.value;
  if (!d) return;
  try {
    setStatus('pausing…');
    const outcome = await d.pause();
    running.value = false;

    if (outcome === 'paused') {
      settled = false; // the belt is still coasting down; see the effect below
      paused.value = true;
      holdSession(true);
      setStatus('paused', 'ok');
      log(`paused at ${toMph(settings.value.targetKmh).toFixed(1)} mph`, 'ok');
      return;
    }

    pauseAccepted.value = false;
    paused.value = false;
    holdSession(false);
    setStatus('this treadmill has no pause — belt stopped instead', 'err');
    log('unit rejected pause; stopped instead — hiding the button', 'err');
  } catch (e) {
    fail(e);
  }
}

export async function doStop() {
  const d = driver.value;
  if (!d) return;
  try {
    setStatus('stopping…');
    await d.stop();
    running.value = false;
    paused.value = false;
    holdSession(false);
    setStatus('stopped', 'ok');
    log('stopped', 'ok');
  } catch (e) {
    fail(e);
  }
}

/** File the paused walk now rather than waiting for the hold to lapse. */
export function endWalk() {
  paused.value = false;
  holdSession(false);
  closeSession('ended');
}

/** Has the belt actually come to rest since the pause was issued? */
let settled = false;

// The belt can also be restarted from its own remote or handrail, and then the app is not
// paused whatever the button last said. But a belt does not stop dead when told to pause —
// it coasts down over several seconds — so "still moving" during that ramp is not somebody
// restarting it. Only movement *after* the belt has settled ends the pause.
effect(() => {
  if (!paused.value) return;
  if (!isMoving.value) {
    settled = true;
    return;
  }
  if (settled) {
    paused.value = false;
    holdSession(false);
  }
});

/** Set an absolute target, clamped to the unit's real range. */
export async function setTarget(kmh: number) {
  const d = driver.value;
  if (!d) return;
  const next = Math.min(Math.max(Math.round(kmh * 10) / 10, d.minSpeedKmh), d.maxSpeedKmh);
  if (next === settings.value.targetKmh) return;
  updateSettings({ targetKmh: next });
  if (!running.value) return; // just move the setpoint while stopped
  try {
    await d.setSpeed(next);
    log(`speed → ${toMph(next).toFixed(1)} mph (${next.toFixed(1)} km/h)`);
  } catch (e) {
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
    if (e.key === 'Escape' && driver.value) void doStop();
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
