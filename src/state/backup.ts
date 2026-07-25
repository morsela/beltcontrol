/**
 * Whole-history backup: JSON out, JSON back in.
 *
 * The CSV export is for spreadsheets — it flattens each session to one row and drops
 * the speed samples, and nothing reads it back. This file is the lossless half: every
 * field the app stores, including per-session samples and settings, in a shape that
 * survives a round trip through a file and a different browser.
 *
 * Everything arriving from a file is untrusted. A backup can be hand-edited, truncated
 * by a full disk, or written by an older build, and whatever it contains lands straight
 * in localStorage and then in the charts. So the import path validates field by field
 * and drops what it cannot vouch for, rather than casting and hoping.
 */
import {
  sessions,
  mergeSessions,
  MAX_SAMPLES,
  type Sample,
  type Session,
} from './session.js';
import { settings, updateSettings, type Settings } from './settings.js';
import { trustFor, type Trust, type TrustMap, type TrustedField } from './telemetry.js';
import type { DriverId } from '../lib/drivers.js';

export const BACKUP_SCHEMA = 'walkingpad.backup.v1';

export interface Backup {
  schema: typeof BACKUP_SCHEMA;
  exportedAt: string;
  settings: Settings;
  sessions: Session[];
}

export interface ImportResult {
  added: number;
  /** Already present under the same id — importing the same file twice is safe. */
  duplicate: number;
  /** Entries too malformed to trust. */
  skipped: number;
  settingsRestored: boolean;
}

/** Thrown when the file is not a backup at all, as opposed to one with bad rows in it. */
export class BackupError extends Error {}

// --- export ----------------------------------------------------------------

/** Completed sessions only — the walk still in progress is deliberately left out, so
 *  that importing this file later cannot collide with the same session once it is
 *  finalised and carries its real totals. */
export function buildBackup(at = Date.now()): Backup {
  return {
    schema: BACKUP_SCHEMA,
    exportedAt: new Date(at).toISOString(),
    settings: settings.value,
    sessions: sessions.value,
  };
}

export function exportJson(at = Date.now()): string {
  return JSON.stringify(buildBackup(at), null, 2);
}

// --- validation ------------------------------------------------------------

const TRUSTS: readonly Trust[] = ['ok', 'unverified', 'absent'];
const DRIVER_IDS: readonly DriverId[] = ['classic', 'ftms', 'fitshow', 'ks1234'];
const TRUSTED_FIELDS: readonly TrustedField[] = ['distKm', 'steps', 'kcal'];
const HERO_METRICS: readonly Settings['heroMetric'][] = ['time', 'distance', 'steps', 'kcal'];

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Finite numbers only, clamped at zero: a negative distance or a NaN duration would
 *  poison every total it touches, and there is no honest way to recover the real value. */
const num = (v: unknown, fallback = 0): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : fallback;

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

function sanitizeTrust(v: unknown, protocol: DriverId | null): TrustMap {
  // No usable trust map means falling back to the protocol's known one; if the
  // protocol is unknown too, trustFor() returns all-absent, which excludes the
  // session's numbers from every aggregate. Under-trusting is the safe direction.
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
  const startedAt = typeof v.startedAt === 'number' && Number.isFinite(v.startedAt) ? v.startedAt : null;
  if (startedAt == null || startedAt <= 0) return null;

  const endedAt =
    typeof v.endedAt === 'number' && Number.isFinite(v.endedAt) ? v.endedAt : null;
  const protocol =
    typeof v.protocol === 'string' && (DRIVER_IDS as readonly string[]).includes(v.protocol)
      ? (v.protocol as DriverId)
      : null;

  return {
    id: str(v.id) ?? `imported-${startedAt.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
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

/** Only the keys that survive validation are applied, so a backup missing half its
 *  settings leaves the rest of the current ones alone. */
function sanitizeSettings(v: unknown): Partial<Settings> {
  if (!isObj(v)) return {};
  const out: Partial<Settings> = {};
  if (typeof v.goalMinutes === 'number' && Number.isFinite(v.goalMinutes) && v.goalMinutes > 0) {
    out.goalMinutes = Math.round(v.goalMinutes);
  }
  if (Array.isArray(v.presetsMph)) {
    const presets = v.presetsMph.filter(
      (p): p is number => typeof p === 'number' && Number.isFinite(p) && p > 0
    );
    if (presets.length > 0) out.presetsMph = presets;
  }
  if (typeof v.heroMetric === 'string' && (HERO_METRICS as readonly string[]).includes(v.heroMetric)) {
    out.heroMetric = v.heroMetric as Settings['heroMetric'];
  }
  if (typeof v.targetKmh === 'number' && Number.isFinite(v.targetKmh) && v.targetKmh > 0) {
    out.targetKmh = v.targetKmh;
  }
  return out;
}

// --- import ----------------------------------------------------------------

/**
 * Read a backup file into the app. Throws `BackupError` with a sentence fit to show
 * the user when the text is not a backup; a file that *is* a backup but carries junk
 * rows imports what it can and reports the rest as `skipped`.
 */
export function importBackup(text: string, opts: { settings?: boolean } = {}): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BackupError('That file is not valid JSON.');
  }
  if (!isObj(parsed)) throw new BackupError('That file is not a backup.');
  if (parsed.schema !== BACKUP_SCHEMA) {
    throw new BackupError(
      `Unrecognised backup format${typeof parsed.schema === 'string' ? ` (${parsed.schema})` : ''}. Expected ${BACKUP_SCHEMA}.`
    );
  }
  if (!Array.isArray(parsed.sessions)) throw new BackupError('That backup has no sessions in it.');

  let skipped = 0;
  const incoming: Session[] = [];
  for (const raw of parsed.sessions) {
    const s = sanitizeSession(raw);
    if (s) incoming.push(s);
    else skipped++;
  }

  const { added, duplicate } = mergeSessions(incoming);

  let settingsRestored = false;
  if (opts.settings !== false) {
    const patch = sanitizeSettings(parsed.settings);
    if (Object.keys(patch).length > 0) {
      updateSettings(patch);
      settingsRestored = true;
    }
  }

  return { added, duplicate, skipped, settingsRestored };
}
