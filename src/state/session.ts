import { signal, computed, effect } from '@preact/signals';
import type { DriverId } from '../lib/drivers.js';
import {
  live,
  isMoving,
  trustFor,
  type Trust,
  type TrustMap,
  type TrustedField,
} from './telemetry.js';
import { dayKey, startOfDay } from '../lib/format.js';
import { log } from './log.js';
import { trackEvent } from '../lib/analytics.js';

const SESSIONS_KEY = 'wp.sessions.v1';
const OPEN_KEY = 'wp.session.open.v1';

/** A lull shorter than this does not split a session — desk walkers stop constantly. */
const IDLE_END_MS = 60_000;
/** How long an *explicit* pause holds an idle session open on top of that. Long enough
 *  for a call or a coffee; short enough that a walk abandoned at lunch is filed as a
 *  lunchtime walk rather than absorbing whatever happens at four o'clock. */
const PAUSE_HOLD_MS = 15 * 60_000;
/** Anything shorter than this is noise (a nudged belt, a mis-tap). */
const MIN_SESSION_MS = 30_000;
/** One sample per this interval feeds the session speed chart. */
const SAMPLE_EVERY_MS = 10_000;
/** ~2 hours of samples. Beyond that we stop growing the array. */
export const MAX_SAMPLES = 720;

export interface Sample {
  /** ms offset from session start */
  t: number;
  kmh: number;
}

export interface Session {
  id: string;
  startedAt: number;
  endedAt: number | null;
  /** Wall-clock milliseconds with the belt actually moving. Protocol-independent
   *  and immune to the pad's counter resets, so this is the canonical duration. */
  activeMs: number;
  distKm: number;
  steps: number;
  kcal: number;
  protocol: DriverId | null;
  protocolName: string | null;
  deviceName: string | null;
  trust: TrustMap;
  samples: Sample[];
}


// --- validation ------------------------------------------------------------
//
// Everything in localStorage is untrusted input. Not because an attacker is assumed —
// same-origin storage is only reachable by this app — but because *this app* wrote it,
// across versions, possibly interrupted by a full disk or a crash mid-write. It was
// being read back with a bare `as Session[]`, and one bad record was enough to take
// the app down on every load with no way back in:
//
//   a session missing `trust`      -> TypeError in the Today render path
//   a non-numeric `distKm`         -> every total NaN, permanently
//
// A malformed record is dropped rather than repaired where it cannot be placed on the
// calendar at all; everything else is coerced into range. Under-trusting is the safe
// direction — an unknown protocol yields an all-absent trust map, which excludes the
// session's numbers from every aggregate instead of inventing kilometres.

const TRUSTS: readonly Trust[] = ['ok', 'unverified', 'absent'];
const DRIVER_IDS: readonly DriverId[] = ['classic', 'ftms', 'fitshow', 'ks1234'];
const TRUSTED_FIELDS: readonly TrustedField[] = ['distKm', 'steps', 'kcal'];

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Finite numbers only, clamped at zero: a negative distance or a NaN duration would
 *  poison every total it touches, and there is no honest way to recover the real value. */
const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : fallback;

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

function sanitizeTrust(v: unknown, protocol: DriverId | null): TrustMap {
  const fallback = trustFor(protocol);
  if (!isObj(v)) return fallback;
  const out = { ...fallback };
  for (const f of TRUSTED_FIELDS) {
    const t = v[f];
    if (typeof t === 'string' && (TRUSTS as readonly string[]).includes(t)) out[f] = t as Trust;
  }
  return out;
}

function sanitizeSamples(v: unknown): Sample[] {
  if (!Array.isArray(v)) return [];
  const out: Sample[] = [];
  for (const s of v) {
    if (out.length >= MAX_SAMPLES) break;
    if (!isObj(s)) continue;
    if (typeof s.t !== 'number' || !Number.isFinite(s.t)) continue;
    if (typeof s.kmh !== 'number' || !Number.isFinite(s.kmh)) continue;
    out.push({ t: Math.max(0, s.t), kmh: Math.max(0, s.kmh) });
  }
  return out;
}

/** `null` when the entry cannot be placed on the calendar — a session with no usable
 *  start time has nowhere to go in any chart, total or streak. */
export function sanitizeSession(v: unknown): Session | null {
  if (!isObj(v)) return null;
  const startedAt =
    typeof v.startedAt === 'number' && Number.isFinite(v.startedAt) ? v.startedAt : null;
  if (startedAt == null || startedAt <= 0) return null;

  const endedAt = typeof v.endedAt === 'number' && Number.isFinite(v.endedAt) ? v.endedAt : null;
  const protocol =
    typeof v.protocol === 'string' && (DRIVER_IDS as readonly string[]).includes(v.protocol)
      ? (v.protocol as DriverId)
      : null;

  return {
    id:
      str(v.id) ??
      `imported-${startedAt.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    startedAt,
    endedAt,
    activeMs: num(v.activeMs),
    distKm: num(v.distKm),
    steps: num(v.steps),
    kcal: num(v.kcal),
    protocol,
    protocolName: str(v.protocolName),
    deviceName: str(v.deviceName),
    trust: sanitizeTrust(v.trust, protocol),
    samples: sanitizeSamples(v.samples),
  };
}

// --- accumulators ----------------------------------------------------------

/**
 * The pad's counters are cumulative-since-power-on and reset without warning
 * (power cycle, standby, a protocol quirk). Differencing them naively yields
 * negative deltas that silently corrupt every total, so a drop is treated as a
 * reset: rebase on the new value and keep accumulating from there.
 */
export class Counter {
  private last: number | null = null;
  total = 0;

  observe(v: number | null | undefined) {
    if (v == null || !Number.isFinite(v)) return;
    if (this.last == null) {
      this.last = v; // first observation is the baseline, not a delta
      return;
    }
    if (v < this.last) {
      log(`counter reset detected (${this.last} -> ${v}); rebasing`);
      this.last = v;
      return;
    }
    this.total += v - this.last;
    this.last = v;
  }

  seed(total: number) {
    this.total = total;
  }
}

// --- live session state ----------------------------------------------------

export const currentSession = signal<Session | null>(null);
export const sessions = signal<Session[]>(loadSessions());

let counters = { dist: new Counter(), steps: new Counter(), kcal: new Counter() };
let lastTickAt: number | null = null;
let lastMoveAt: number | null = null;
let heldSince: number | null = null;
let lastSampleAt = 0;
let ticker: number | null = null;

function loadSessions(): Session[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: Session[] = [];
    let dropped = 0;
    for (const entry of parsed) {
      const s = sanitizeSession(entry);
      if (s) out.push(s);
      else dropped++;
    }
    // Logged rather than silent: history quietly getting shorter is worth noticing.
    if (dropped > 0) log(`dropped ${dropped} unreadable session record(s) from storage`, 'err');
    return out;
  } catch {
    return [];
  }
}

function persistSessions() {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions.value));
  } catch {
    /* quota — keep running, just stop remembering */
  }
}

function persistOpen() {
  try {
    if (currentSession.value) {
      localStorage.setItem(OPEN_KEY, JSON.stringify(currentSession.value));
    } else {
      localStorage.removeItem(OPEN_KEY);
    }
  } catch {
    /* ignore */
  }
}

/**
 * Recover a session that was in flight when the page reloaded.
 *
 * Called twice by design — once at startup, so a walk left open can still be closed by
 * the idle rule while nothing is connected, and again when a driver is wired, because
 * that is the first moment a reconnect could be picking one back up. So it has to be
 * safe to call against a session that is already running, and it was not: the second
 * call overwrote the live record with the last copy written to storage, which lags it by
 * up to the 5 s checkpoint interval, and re-seeded the counters from those older totals.
 * Connecting mid-walk quietly rewound the walk.
 *
 * A session already open is the authority on itself. The stored copy is a checkpoint of
 * that same session, never a better one.
 */
export function restoreOpenSession() {
  if (currentSession.value) return;
  try {
    const raw = localStorage.getItem(OPEN_KEY);
    if (!raw) return;
    const s = sanitizeSession(JSON.parse(raw));
    if (!s) {
      localStorage.removeItem(OPEN_KEY);
      log('discarded an unreadable in-flight session record', 'err');
      return;
    }
    // A stale open session from days ago should be filed, not resumed.
    if (Date.now() - s.startedAt > 12 * 3600_000) {
      finalise(s);
      localStorage.removeItem(OPEN_KEY);
      return;
    }
    currentSession.value = s;
    counters.dist.seed(s.distKm);
    counters.steps.seed(s.steps);
    counters.kcal.seed(s.kcal);
    lastMoveAt = Date.now();
    log(`recovered in-flight session from ${new Date(s.startedAt).toLocaleTimeString()}`);
  } catch {
    /* ignore */
  }
}

function open(meta: SessionMeta) {
  counters = { dist: new Counter(), steps: new Counter(), kcal: new Counter() };
  lastTickAt = Date.now();
  lastSampleAt = 0;
  currentSession.value = {
    id: `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    startedAt: Date.now(),
    endedAt: null,
    activeMs: 0,
    distKm: 0,
    steps: 0,
    kcal: 0,
    protocol: meta.protocol,
    protocolName: meta.protocolName,
    deviceName: meta.deviceName,
    trust: trustFor(meta.protocol),
    samples: [],
  };
  log('session started', 'ok');
}

function finalise(s: Session) {
  const done: Session = { ...s, endedAt: s.endedAt ?? Date.now() };
  sessions.value = [...sessions.value, done].sort((a, b) => a.startedAt - b.startedAt);
  persistSessions();
}

/**
 * Hold the open session across a deliberate pause.
 *
 * Held, an idle belt gets `PAUSE_HOLD_MS` before the walk ends rather than the usual
 * `IDLE_END_MS`, so stepping away and coming back leaves one session instead of two —
 * or, when the tail falls under the 30 s floor, instead of one and a discarded scrap.
 * It never adds time: `activeMs` still only accrues while the belt is moving.
 *
 * Releasing it is the caller's business, because only the caller can tell a belt that is
 * coasting down from a pause apart from one somebody has just set going again. The cap
 * above is the backstop for a hold nobody ever releases.
 */
export function holdSession(on: boolean) {
  heldSince = on ? Date.now() : null;
}

/** Close the open session, discarding it if it was too short to be real. */
export function closeSession(reason = 'ended') {
  const s = currentSession.value;
  currentSession.value = null;
  heldSince = null;
  persistOpen();
  if (!s) return;
  if (s.activeMs < MIN_SESSION_MS) {
    log(`session discarded (${Math.round(s.activeMs / 1000)}s — below the ${MIN_SESSION_MS / 1000}s floor)`);
    return;
  }
  finalise(s);
  log(`session ${reason}: ${Math.round(s.activeMs / 60000)} min`, 'ok');
  // Rounded minutes and the protocol id — never the device name or per-sample data.
  trackEvent('session_recorded', {
    minutes: Math.round(s.activeMs / 60_000),
    protocol: s.protocol,
  });
}

export interface SessionMeta {
  protocol: DriverId | null;
  protocolName: string | null;
  deviceName: string | null;
}

let meta: SessionMeta = { protocol: null, protocolName: null, deviceName: null };

export function setSessionMeta(m: SessionMeta) {
  meta = m;
}

/**
 * Drives session detection off the telemetry clock rather than off Start/Stop, so a
 * walk still records when the belt is started from its own remote or handrail.
 */
function tick() {
  const now = Date.now();
  const moving = isMoving.value;

  if (moving) {
    lastMoveAt = now;
    if (!currentSession.value) open(meta);
  }

  const s = currentSession.value;
  if (!s) {
    lastTickAt = now;
    return;
  }

  // Accumulate active time only while the belt is actually moving.
  if (moving && lastTickAt != null) {
    const delta = now - lastTickAt;
    // A tab that was backgrounded or a machine that slept should not bank hours.
    s.activeMs += delta > 5_000 ? 1_000 : delta;
  }
  lastTickAt = now;

  const d = live.value;
  counters.dist.observe(d.distKm);
  counters.steps.observe(d.steps);
  counters.kcal.observe(d.kcal);
  s.distKm = counters.dist.total;
  s.steps = counters.steps.total;
  s.kcal = counters.kcal.total;

  if (moving && now - lastSampleAt >= SAMPLE_EVERY_MS) {
    lastSampleAt = now;
    if (s.samples.length < MAX_SAMPLES) {
      s.samples.push({ t: now - s.startedAt, kmh: d.speedKmh ?? 0 });
    }
  }

  // Nudge the signal so subscribers re-read the mutated object.
  currentSession.value = { ...s };

  if (!moving && lastMoveAt != null && now - lastMoveAt > IDLE_END_MS) {
    if (heldSince == null) closeSession('ended (idle)');
    else if (now - heldSince > PAUSE_HOLD_MS) {
      closeSession(`ended (paused over ${PAUSE_HOLD_MS / 60_000} min)`);
    }
  }
}

export function startSessionTracking() {
  if (ticker != null) return;
  lastTickAt = Date.now();
  ticker = window.setInterval(tick, 1000);
}

export function stopSessionTracking() {
  if (ticker != null) window.clearInterval(ticker);
  ticker = null;
}

// Persist the in-flight session periodically so a reload mid-walk recovers it.
let persistAt = 0;
effect(() => {
  const s = currentSession.value;
  if (!s) return;
  const now = Date.now();
  if (now - persistAt > 5_000) {
    persistAt = now;
    persistOpen();
  }
});

// --- aggregates ------------------------------------------------------------

export interface DayTotal {
  key: string;
  date: number;
  minutes: number;
  /** Only summed across sessions whose protocol reports the field in real units. */
  distKm: number;
  steps: number;
  kcal: number;
  /** How many sessions that day carried an unverified distance/step scale. */
  excluded: number;
}

/** Today's totals, including the session still in progress. */
export const todayTotals = computed<DayTotal>(() => {
  const key = dayKey(Date.now());
  const all = [...sessions.value, ...(currentSession.value ? [currentSession.value] : [])];
  return foldDay(key, startOfDay(Date.now()), all);
});

function foldDay(key: string, date: number, all: Session[]): DayTotal {
  const out: DayTotal = { key, date, minutes: 0, distKm: 0, steps: 0, kcal: 0, excluded: 0 };
  for (const s of all) {
    if (dayKey(s.startedAt) !== key) continue;
    out.minutes += s.activeMs / 60_000;
    // Unverified fields never enter a total. A history screen that quietly sums
    // raw, unscaled numbers as if they were kilometres is worse than no history.
    if (s.trust.distKm === 'ok') out.distKm += s.distKm;
    else if (s.distKm > 0) out.excluded++;
    if (s.trust.steps === 'ok') out.steps += s.steps;
    if (s.trust.kcal === 'ok') out.kcal += s.kcal;
  }
  return out;
}

export interface LifetimeTotals {
  /** Wall-clock minutes with the belt moving, across every session ever stored. */
  minutes: number;
  /** Only summed across sessions whose protocol reports distance in real units. */
  distKm: number;
  /** How many sessions are stored, the one in progress included. */
  walks: number;
  /** Distinct calendar days with at least one session on them. */
  days: number;
  /** Sessions carrying a distance on a scale that was never established. */
  excluded: number;
  /** Start of the earliest session, or null when nothing is stored. */
  since: number | null;
}

/**
 * Everything, ever — the running total the odometer on History counts.
 *
 * Same exclusion rule as every other aggregate: an unverified distance is not
 * kilometres and never enters `distKm`. Unlike the day and range totals it also
 * carries the count of what was left out, because a lifetime figure is the one
 * number people quote and it has to be able to say what it does not include.
 *
 * The session in progress is included, so the odometer moves while you walk. That is
 * the whole reason it is a rolling counter rather than a printed number.
 */
export const lifetimeTotals = computed<LifetimeTotals>(() => {
  const all = [...sessions.value, ...(currentSession.value ? [currentSession.value] : [])];
  const out: LifetimeTotals = {
    minutes: 0,
    distKm: 0,
    walks: all.length,
    days: 0,
    excluded: 0,
    since: null,
  };
  const days = new Set<string>();
  for (const s of all) {
    out.minutes += s.activeMs / 60_000;
    if (s.trust.distKm === 'ok') out.distKm += s.distKm;
    else if (s.distKm > 0) out.excluded++;
    days.add(dayKey(s.startedAt));
    if (out.since == null || s.startedAt < out.since) out.since = s.startedAt;
  }
  out.days = days.size;
  return out;
});

/** The last `days` days, oldest first, with empty days present as zeroes. */
export function dailySeries(days: number): DayTotal[] {
  const all = [...sessions.value, ...(currentSession.value ? [currentSession.value] : [])];
  const today = startOfDay(Date.now());
  const out: DayTotal[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = today - i * 86_400_000;
    out.push(foldDay(dayKey(date), date, all));
  }
  return out;
}

/** Consecutive days up to today meeting the goal. */
export function streak(goalMinutes: number): number {
  const series = dailySeries(400);
  let n = 0;
  for (let i = series.length - 1; i >= 0; i--) {
    const d = series[i];
    if (!d) break;
    // Today not yet met does not break a streak that is still live.
    if (i === series.length - 1 && d.minutes < goalMinutes) continue;
    if (d.minutes >= goalMinutes) n++;
    else break;
  }
  return n;
}

export function sessionsOn(key: string): Session[] {
  const all = [...sessions.value, ...(currentSession.value ? [currentSession.value] : [])];
  return all.filter((s) => dayKey(s.startedAt) === key).sort((a, b) => b.startedAt - a.startedAt);
}

export function deleteSession(id: string) {
  sessions.value = sessions.value.filter((s) => s.id !== id);
  persistSessions();
}

/**
 * Fold sessions from a backup into the stored history.
 *
 * Merge, never replace: restoring onto a browser that already has walks in it must
 * not throw them away. An id already present wins over the incoming copy, so
 * importing the same file twice is a no-op rather than a doubled history.
 */
export function mergeSessions(incoming: Session[]): { added: number; duplicate: number } {
  const byId = new Map(sessions.value.map((s) => [s.id, s]));
  let added = 0;
  let duplicate = 0;
  for (const s of incoming) {
    if (byId.has(s.id)) {
      duplicate++;
      continue;
    }
    byId.set(s.id, s);
    added++;
  }
  if (added > 0) {
    sessions.value = [...byId.values()].sort((a, b) => a.startedAt - b.startedAt);
    persistSessions();
  }
  return { added, duplicate };
}

/**
 * One CSV field, quoted the way RFC 4180 actually specifies and defanged for
 * spreadsheets.
 *
 * The device name is the reason this needs care: it arrives over the air from whatever
 * the pad advertises, and "Show all devices" will happily connect to anything. Two
 * separate problems come with that.
 *
 * `JSON.stringify` was doing the quoting, which escapes an embedded quote as \" —
 * valid JSON, invalid CSV, where the escape is a doubled quote. A name containing one
 * corrupted the row.
 *
 * And a leading =, +, -, @, tab or CR makes Excel, Sheets and LibreOffice treat the
 * cell as a formula rather than text, quoting notwithstanding: a device advertising
 * itself as `=cmd|' /C calc'!A0` lands as a live formula in the exported file. The
 * usual fix is to prefix a single quote, which those apps read as "this is text".
 */
export function csvField(value: unknown): string {
  const s = String(value ?? '');
  const defanged = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${defanged.replace(/"/g, '""')}"`;
}

export function exportCsv(): string {
  const rows = [
    'started,ended,active_minutes,distance_km,steps,kcal,protocol,device,distance_trust,steps_trust',
  ];
  for (const s of sessions.value) {
    rows.push(
      [
        new Date(s.startedAt).toISOString(),
        s.endedAt ? new Date(s.endedAt).toISOString() : '',
        (s.activeMs / 60_000).toFixed(2),
        s.distKm.toFixed(3),
        Math.round(s.steps),
        Math.round(s.kcal),
        s.protocol ?? '',
        csvField(s.deviceName ?? ''),
        s.trust.distKm,
        s.trust.steps,
      ].join(',')
    );
  }
  return rows.join('\n');
}
