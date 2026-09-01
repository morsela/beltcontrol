import { describe, it, expect, beforeEach, vi } from 'vitest';

const SESSIONS_KEY = 'wp.sessions.v1';
const OPEN_KEY = 'wp.session.open.v1';

/**
 * These reach for the module's *load* path, which runs once at import — so each case
 * seeds localStorage first and then imports a fresh copy of the module.
 */
async function freshStore(seed: unknown, key = SESSIONS_KEY) {
  localStorage.clear();
  if (seed !== undefined) localStorage.setItem(key, JSON.stringify(seed));
  vi.resetModules();
  return await import('../src/state/session.js');
}

describe('reading sessions back out of storage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('drops a record with no usable start time rather than filing it nowhere', async () => {
    const { sessions } = await freshStore([
      { id: 'a', startedAt: 1_700_000_000_000, activeMs: 60_000 },
      { id: 'b' }, // no startedAt
      { id: 'c', startedAt: 'yesterday' },
      null,
      'not even an object',
    ]);
    expect(sessions.value).toHaveLength(1);
    expect(sessions.value[0]!.id).toBe('a');
  });

  it('supplies a trust map for a record that has none', async () => {
    // The crash that motivated this: Today.tsx reads s.trust.distKm directly.
    const { sessions } = await freshStore([
      { id: 'a', startedAt: 1_700_000_000_000, activeMs: 60_000, protocol: 'ftms' },
    ]);
    const s = sessions.value[0]!;
    expect(s.trust).toEqual({ distKm: 'ok', steps: 'absent', kcal: 'ok' });
    expect(() => s.trust.distKm === 'ok').not.toThrow();
  });

  it('falls back to an all-absent trust map when the protocol is unrecognised', async () => {
    const { sessions } = await freshStore([
      { id: 'a', startedAt: 1_700_000_000_000, protocol: 'not-a-protocol' },
    ]);
    const s = sessions.value[0]!;
    expect(s.protocol).toBeNull();
    // All-absent keeps the numbers out of every aggregate rather than inventing units.
    expect(s.trust).toEqual({ distKm: 'absent', steps: 'absent', kcal: 'absent' });
  });

  it('coerces numbers that would otherwise poison every total', async () => {
    const { sessions, todayTotals } = await freshStore([
      {
        id: 'a',
        startedAt: Date.now(),
        activeMs: 'abc',
        distKm: NaN,
        steps: -500,
        kcal: null,
        protocol: 'classic',
      },
    ]);
    const s = sessions.value[0]!;
    expect(s.activeMs).toBe(0);
    expect(s.distKm).toBe(0);
    expect(s.steps).toBe(0); // negatives clamped, not carried
    expect(s.kcal).toBe(0);
    expect(Number.isNaN(todayTotals.value.distKm)).toBe(false);
    expect(Number.isNaN(todayTotals.value.minutes)).toBe(false);
  });

  it('drops samples that are not usable points', async () => {
    const { sessions } = await freshStore([
      {
        id: 'a',
        startedAt: 1_700_000_000_000,
        samples: [{ t: 0, kmh: 2 }, { t: 'x', kmh: 1 }, { kmh: 1 }, null, { t: 10, kmh: NaN }],
      },
    ]);
    expect(sessions.value[0]!.samples).toEqual([{ t: 0, kmh: 2 }]);
  });

  it('survives storage that is not an array, and storage that is not JSON', async () => {
    expect((await freshStore({ nope: true })).sessions.value).toEqual([]);
    localStorage.clear();
    localStorage.setItem(SESSIONS_KEY, '{ truncated');
    vi.resetModules();
    const { sessions } = await import('../src/state/session.js');
    expect(sessions.value).toEqual([]);
  });

  it('discards an unreadable in-flight session instead of resuming it', async () => {
    const { restoreOpenSession, currentSession } = await freshStore(
      { id: 'open', startedAt: 'nonsense' },
      OPEN_KEY
    );
    restoreOpenSession();
    expect(currentSession.value).toBeNull();
    expect(localStorage.getItem(OPEN_KEY)).toBeNull();
  });

  it('files a stale in-flight session at an end it can vouch for', async () => {
    // Three days old. `finalise` would have stamped the end as *now*, filing a walk
    // abandoned on Tuesday as one that ran until Friday.
    const started = Date.now() - 3 * 24 * 3600_000;
    const { restoreOpenSession, currentSession, sessions } = await freshStore(
      { id: 'stale', startedAt: started, activeMs: 20 * 60_000, protocol: 'classic' },
      OPEN_KEY
    );
    restoreOpenSession();

    expect(currentSession.value).toBeNull();
    expect(localStorage.getItem(OPEN_KEY)).toBeNull();
    expect(sessions.value).toHaveLength(1);
    expect(sessions.value[0]?.endedAt).toBe(started + 20 * 60_000);
  });

  it('discards a stale scrap rather than filing it as a walk', async () => {
    const started = Date.now() - 3 * 24 * 3600_000;
    const { restoreOpenSession, sessions } = await freshStore(
      { id: 'scrap', startedAt: started, activeMs: 4_000, protocol: 'classic' },
      OPEN_KEY
    );
    restoreOpenSession();

    // Under the 30 s floor every other session is held to. Filing it was the only way
    // a sub-floor walk could reach the history.
    expect(sessions.value).toEqual([]);
    expect(localStorage.getItem(OPEN_KEY)).toBeNull();
  });

  it('leaves a session already in flight alone', async () => {
    // Called at startup and again when a driver is wired, so it meets a live session
    // whenever somebody connects mid-walk. The stored copy is a checkpoint of that same
    // session, up to 5 s behind it — never a better one.
    const started = Date.now() - 60_000;
    const { restoreOpenSession, currentSession } = await freshStore(
      { id: 'open', startedAt: started, activeMs: 45_000, distKm: 1.2, protocol: 'classic' },
      OPEN_KEY
    );
    restoreOpenSession();
    // The walk moves on past the checkpoint in storage.
    currentSession.value = { ...currentSession.value!, activeMs: 61_000, distKm: 1.5 };

    restoreOpenSession();

    expect(currentSession.value?.activeMs).toBe(61_000);
    expect(currentSession.value?.distKm).toBe(1.5);
  });

  it('still resumes a valid in-flight session', async () => {
    const started = Date.now() - 60_000;
    const { restoreOpenSession, currentSession } = await freshStore(
      { id: 'open', startedAt: started, activeMs: 45_000, distKm: 1.2, protocol: 'classic' },
      OPEN_KEY
    );
    restoreOpenSession();
    expect(currentSession.value?.id).toBe('open');
    expect(currentSession.value?.activeMs).toBe(45_000);
  });
});
