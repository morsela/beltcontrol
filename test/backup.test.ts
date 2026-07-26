import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  buildBackup,
  exportJson,
  importBackup,
  sanitizeSession,
  BackupError,
  BACKUP_SCHEMA,
} from '../src/state/backup.js';
import { sessions, currentSession, mergeSessions, MAX_SAMPLES, type Session } from '../src/state/session.js';
import { settings, updateSettings } from '../src/state/settings.js';
import { trustFor } from '../src/state/telemetry.js';
import type { DriverId } from '../src/lib/drivers.js';

const HOUR = 3_600_000;

function session(over: Partial<Session> & { protocol: DriverId }): Session {
  const startedAt = over.startedAt ?? Date.now() - HOUR;
  return {
    id: Math.random().toString(36).slice(2),
    startedAt,
    endedAt: startedAt + 1_800_000,
    activeMs: 30 * 60_000,
    distKm: 2,
    steps: 3_000,
    kcal: 120,
    protocolName: over.protocol,
    deviceName: 'WalkingPad',
    trust: trustFor(over.protocol),
    samples: [{ t: 0, kmh: 2 }, { t: 10_000, kmh: 2.4 }],
    ...over,
  };
}

const DEFAULT_SETTINGS = { ...settings.value };

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 5, 9, 14, 0, 0));
  sessions.value = [];
  currentSession.value = null;
  settings.value = { ...DEFAULT_SETTINGS };
});

afterEach(() => {
  vi.useRealTimers();
  sessions.value = [];
  currentSession.value = null;
  settings.value = { ...DEFAULT_SETTINGS };
  localStorage.clear();
});

describe('buildBackup', () => {
  it('carries the schema tag, so an import can tell a backup from any other JSON', () => {
    expect(buildBackup().schema).toBe(BACKUP_SCHEMA);
  });

  it('leaves the walk still in progress out', () => {
    // Exporting a half-finished session would collide with the same id once the
    // session closes and carries its real totals.
    sessions.value = [session({ protocol: 'classic' })];
    currentSession.value = session({ protocol: 'classic', activeMs: 60_000 });
    expect(buildBackup().sessions).toHaveLength(1);
  });

  it('keeps the speed samples the CSV drops', () => {
    sessions.value = [session({ protocol: 'classic' })];
    expect(buildBackup().sessions[0]!.samples).toHaveLength(2);
  });
});

describe('round trip', () => {
  it('restores an identical history into an empty browser', () => {
    updateSettings({ goalMinutes: 45, presetsMph: [1.5, 2.5], heroMetric: 'steps' });
    sessions.value = [
      session({ protocol: 'classic', startedAt: Date.now() - 26 * HOUR }),
      session({ protocol: 'ks1234', startedAt: Date.now() - HOUR, distKm: 999 }),
    ];
    const file = exportJson();
    const before = JSON.parse(JSON.stringify(sessions.value));

    sessions.value = [];
    settings.value = { ...DEFAULT_SETTINGS };
    const r = importBackup(file);

    expect(r).toMatchObject({ added: 2, duplicate: 0, skipped: 0, settingsRestored: true });
    expect(sessions.value).toEqual(before);
    expect(settings.value.goalMinutes).toBe(45);
    expect(settings.value.heroMetric).toBe('steps');
  });

  it('preserves the trust map, so an unverified number stays unverified after a restore', () => {
    // Stated outright: the point is that a restore carries the stored map through, not
    // that any particular protocol is unverified this week.
    sessions.value = [
      session({ protocol: 'classic', trust: { distKm: 'unverified', steps: 'ok', kcal: 'absent' } }),
    ];
    const file = exportJson();
    sessions.value = [];
    importBackup(file);
    expect(sessions.value[0]!.trust.distKm).toBe('unverified');
  });

  it('is idempotent — importing the same file twice does not double the history', () => {
    sessions.value = [session({ protocol: 'classic' })];
    const file = exportJson();
    const r = importBackup(file);
    expect(r).toMatchObject({ added: 0, duplicate: 1 });
    expect(sessions.value).toHaveLength(1);
  });

  it('merges into existing history rather than replacing it', () => {
    const mine = session({ protocol: 'classic', startedAt: Date.now() - 2 * HOUR });
    sessions.value = [mine];
    const theirs = session({ protocol: 'ftms', startedAt: Date.now() - 5 * HOUR });
    const file = JSON.stringify({ schema: BACKUP_SCHEMA, exportedAt: '', sessions: [theirs] });

    importBackup(file);
    expect(sessions.value.map((s) => s.id)).toEqual([theirs.id, mine.id]); // oldest first
  });

  it('can be restored without touching the current settings', () => {
    updateSettings({ goalMinutes: 45 });
    const file = exportJson();
    updateSettings({ goalMinutes: 90 });
    const r = importBackup(file, { settings: false });
    expect(r.settingsRestored).toBe(false);
    expect(settings.value.goalMinutes).toBe(90);
  });
});

describe('importBackup rejects what is not a backup', () => {
  it('refuses text that is not JSON', () => {
    expect(() => importBackup('not json at all')).toThrow(BackupError);
  });

  it('refuses JSON without the schema tag, naming what it expected', () => {
    expect(() => importBackup('{"sessions":[]}')).toThrow(/Expected walkingpad\.backup\.v1/);
  });

  it('refuses a backup whose sessions are not a list', () => {
    const file = JSON.stringify({ schema: BACKUP_SCHEMA, sessions: { nope: true } });
    expect(() => importBackup(file)).toThrow(BackupError);
  });

  it('leaves the stored history untouched when it refuses', () => {
    sessions.value = [session({ protocol: 'classic' })];
    expect(() => importBackup('{}')).toThrow();
    expect(sessions.value).toHaveLength(1);
  });
});

describe('sanitizeSession', () => {
  const valid = { startedAt: Date.now(), id: 'a' };

  it('drops an entry with no usable start time — it has nowhere to go on the calendar', () => {
    expect(sanitizeSession({ ...valid, startedAt: undefined })).toBeNull();
    expect(sanitizeSession({ ...valid, startedAt: 'yesterday' })).toBeNull();
    expect(sanitizeSession({ ...valid, startedAt: NaN })).toBeNull();
    expect(sanitizeSession(null)).toBeNull();
    expect(sanitizeSession([1, 2])).toBeNull();
  });

  it('replaces non-finite and negative numbers with zero rather than poisoning totals', () => {
    const s = sanitizeSession({ ...valid, activeMs: NaN, distKm: -5, steps: 'lots', kcal: Infinity })!;
    expect(s).toMatchObject({ activeMs: 0, distKm: 0, steps: 0, kcal: 0 });
  });

  it('falls back to all-absent trust for an unknown protocol, so its numbers stay out of totals', () => {
    const s = sanitizeSession({ ...valid, protocol: 'made-up', trust: 'nonsense' })!;
    expect(s.protocol).toBeNull();
    expect(s.trust).toEqual({ distKm: 'absent', steps: 'absent', kcal: 'absent' });
  });

  it('falls back to the protocol’s own trust when the map is missing', () => {
    const s = sanitizeSession({ ...valid, protocol: 'classic' })!;
    expect(s.trust).toEqual(trustFor('classic'));
  });

  it('keeps a trust level it recognises and discards one it does not', () => {
    const s = sanitizeSession({
      ...valid,
      protocol: 'classic',
      trust: { distKm: 'unverified', steps: 'sure', kcal: 'ok' },
    })!;
    expect(s.trust).toEqual({ distKm: 'unverified', steps: 'ok', kcal: 'ok' });
  });

  it('drops malformed samples and keeps the good ones', () => {
    const s = sanitizeSession({
      ...valid,
      samples: [{ t: 0, kmh: 2 }, { t: 'x', kmh: 2 }, null, { t: 10, kmh: NaN }, { t: 20, kmh: 3 }],
    })!;
    expect(s.samples).toEqual([{ t: 0, kmh: 2 }, { t: 20, kmh: 3 }]);
  });

  it('caps samples at the same ceiling a live session uses', () => {
    const samples = Array.from({ length: MAX_SAMPLES + 50 }, (_, i) => ({ t: i * 10, kmh: 2 }));
    expect(sanitizeSession({ ...valid, samples })!.samples).toHaveLength(MAX_SAMPLES);
  });

  it('invents an id only when the entry has none, so merging can still dedupe', () => {
    expect(sanitizeSession({ ...valid, id: undefined })!.id).toMatch(/^imported-/);
    expect(sanitizeSession(valid)!.id).toBe('a');
  });

  it('counts what it dropped instead of failing the whole import', () => {
    const file = JSON.stringify({
      schema: BACKUP_SCHEMA,
      sessions: [{ startedAt: Date.now(), id: 'good' }, { id: 'no-start' }, 'junk'],
    });
    expect(importBackup(file)).toMatchObject({ added: 1, skipped: 2 });
  });
});

describe('mergeSessions', () => {
  it('keeps the copy already stored when an id collides', () => {
    const mine = session({ protocol: 'classic', distKm: 2 });
    sessions.value = [mine];
    mergeSessions([{ ...mine, distKm: 999 }]);
    expect(sessions.value[0]!.distKm).toBe(2);
  });

  it('sorts the result oldest first, as the rest of the app expects', () => {
    sessions.value = [session({ protocol: 'classic', startedAt: Date.now() - HOUR })];
    mergeSessions([
      session({ protocol: 'classic', startedAt: Date.now() - 3 * HOUR }),
      session({ protocol: 'classic', startedAt: Date.now() - 2 * HOUR }),
    ]);
    const starts = sessions.value.map((s) => s.startedAt);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  it('persists, so a restored history survives the reload', () => {
    mergeSessions([session({ protocol: 'classic', id: 'kept' })]);
    expect(localStorage.getItem('wp.sessions.v1')).toContain('kept');
  });
});
