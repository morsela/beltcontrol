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
import { sessions, mergeSessions, sanitizeSession, type Session } from './session.js';
import { settings, updateSettings, type Settings } from './settings.js';

export const BACKUP_SCHEMA = 'walkingpad.backup.v1';

// sanitizeSession moved next to the store it guards — every read of session state now
// goes through it, not just the import path. Re-exported because a backup file is the
// other thing it validates, and callers here expect to find it.
export { sanitizeSession } from './session.js';

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

const HERO_METRICS: readonly Settings['heroMetric'][] = ['time', 'distance', 'steps', 'kcal'];

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

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
