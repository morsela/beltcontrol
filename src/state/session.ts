import { signal, computed, effect } from '@preact/signals';
import type { DriverId } from '../lib/drivers.js';
import { live, isMoving, trustFor, type TrustMap } from './telemetry.js';
import { dayKey, startOfDay } from '../lib/format.js';
import { log } from './log.js';

const SESSIONS_KEY = 'wp.sessions.v1';
const OPEN_KEY = 'wp.session.open.v1';

/** A pause shorter than this does not split a session — desk walkers stop constantly. */
const IDLE_END_MS = 60_000;
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
let lastSampleAt = 0;
let ticker: number | null = null;

function loadSessions(): Session[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Session[]) : [];
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

/** Recover a session that was in flight when the page reloaded. */
export function restoreOpenSession() {
  try {
    const raw = localStorage.getItem(OPEN_KEY);
    if (!raw) return;
    const s = JSON.parse(raw) as Session;
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

/** Close the open session, discarding it if it was too short to be real. */
export function closeSession(reason = 'ended') {
  const s = currentSession.value;
  currentSession.value = null;
  persistOpen();
  if (!s) return;
  if (s.activeMs < MIN_SESSION_MS) {
    log(`session discarded (${Math.round(s.activeMs / 1000)}s — below the ${MIN_SESSION_MS / 1000}s floor)`);
    return;
  }
  finalise(s);
  log(`session ${reason}: ${Math.round(s.activeMs / 60000)} min`, 'ok');
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
    closeSession('ended (idle)');
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
