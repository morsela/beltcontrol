import { signal, computed } from '@preact/signals';
import { detectDriver, UUID } from '../lib/drivers.js';
import type { Driver } from '../lib/drivers.js';
import { ingest, resetTelemetry, live, confirmedStopped } from './telemetry.js';
import { log, setStatus, fail } from './log.js';
import { settings, updateSettings } from './settings.js';
import { toMph, toKmh, MPH_STEP } from '../lib/format.js';
import {
  setSessionMeta,
  startSessionTracking,
  stopSessionTracking,
  closeSession,
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

let device: BluetoothDevice | null = null;
let pollTimer: number | null = null;

export const connected = computed(() => phase.value === 'connected');
export const targetKmh = computed(() => settings.value.targetKmh);

/** Belt state for the status chip. Always paired with a text label in the UI —
 *  warn and bad are only dE 5.7 apart under deuteranopia, so colour alone would
 *  be unreadable for a chunk of users. */
export type BeltTone = 'good' | 'warn' | 'bad' | 'idle';

export const beltTone = computed<BeltTone>(() => {
  if (phase.value === 'error') return 'bad';
  if (phase.value === 'choosing' || phase.value === 'connecting') return 'warn';
  if (phase.value !== 'connected') return 'idle';
  return (live.value.speedKmh ?? 0) > 0.05 ? 'good' : 'idle';
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
export async function connectSimulated(id?: 'classic' | 'ftms' | 'ks1234' | 'fitshow') {
  if (!import.meta.env.DEV) return;
  const { simulatedDriver } = await import('../lib/simulator.js');
  await wireDriver(simulatedDriver({ id }), null, `Simulated ${id ?? 'classic'}`);
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
  stopSessionTracking();
  closeSession('ended (disconnected)');
  try {
    await driver.value?.detach();
  } catch {
    /* device already gone */
  }
  driver.value = null;
  running.value = false;
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

export async function doStart() {
  const d = driver.value;
  if (!d) return;

  const ok = confirm(
    `Start the belt at ${toMph(settings.value.targetKmh).toFixed(1)} mph?\n\n` +
      'Make sure the belt is clear and you are ready.'
  );
  if (!ok) return;

  try {
    clearStopWatch(); // a start supersedes any stop still waiting to be confirmed
    setStatus('starting…');
    await d.start();
    running.value = true;
    // Reflect the belt's real default start speed until telemetry reports the actual
    // value — otherwise the UI shows a stale/empty reading for up to a second.
    ingest({ speedKmh: toKmh(START_SPEED_MPH) });
    // Some units ignore a speed set before the belt is actually moving.
    await new Promise((r) => setTimeout(r, 600));
    if (d.capabilities.speed) await d.setSpeed(settings.value.targetKmh);
    setStatus('running', 'ok');
    log(
      `started at ${toMph(settings.value.targetKmh).toFixed(1)} mph ` +
        `(${settings.value.targetKmh.toFixed(1)} km/h)`,
      'ok'
    );
  } catch (e) {
    fail(e);
  }
}

/** How long to wait for the belt to report zero before saying it never confirmed.
 *  A pad decelerating from walking speed reports zero within a second or two. */
const STOP_CONFIRM_MS = 6_000;

let stopWatch: number | null = null;

function clearStopWatch() {
  if (stopWatch != null) window.clearInterval(stopWatch);
  stopWatch = null;
}

/**
 * A resolved `stop()` means the command was written, not that the belt obeyed it.
 * Only two of the four protocols can even acknowledge one — FTMS via its control
 * point, and nothing else — so the belt's own telemetry is the only evidence that
 * applies to every pad. Report "stopped" when it reports zero, and say plainly when
 * it never does, rather than asserting an outcome the app has not observed.
 */
function watchForStop() {
  clearStopWatch();
  const deadline = Date.now() + STOP_CONFIRM_MS;

  const check = () => {
    if (confirmedStopped.value) {
      clearStopWatch();
      running.value = false;
      setStatus('stopped', 'ok');
      log('belt reports zero — stopped', 'ok');
      return;
    }
    if (Date.now() >= deadline) {
      clearStopWatch();
      // Deliberately leaves `running` true: the belt has not said it stopped, so the
      // UI should keep treating it as a belt that might be moving.
      const s = live.value.speedKmh;
      const why =
        s == null
          ? 'it is not reporting speed at all'
          : `it still reports ${toMph(s).toFixed(1)} mph`;
      setStatus(
        `Stop was sent but the belt has not confirmed — ${why}. Use the treadmill's own controls.`,
        'err'
      );
      log(`stop unconfirmed after ${STOP_CONFIRM_MS / 1000}s — ${why}`, 'err');
    }
  };

  check(); // a pad already reporting zero confirms immediately
  if (stopWatch == null && !confirmedStopped.value) {
    // Say what is being waited on. "stopping…" reads as an assertion about the belt;
    // this reads as an assertion about the app, which is all that is known yet.
    setStatus('stop sent — waiting for the belt to report zero');
    stopWatch = window.setInterval(check, 250);
  }
}

export async function doStop() {
  const d = driver.value;
  if (!d) return;
  try {
    setStatus('stopping…');
    await d.stop();
    log('stop sent', 'ok');
    watchForStop();
  } catch (e) {
    clearStopWatch();
    fail(e);
  }
}

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
