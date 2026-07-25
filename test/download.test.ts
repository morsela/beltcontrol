import { describe, it, expect, afterEach, vi } from 'vitest';
import { stamped } from '../src/lib/download.js';

afterEach(() => vi.useRealTimers());

describe('stamped', () => {
  it('names the file for the local day, not the UTC one', () => {
    // An evening export west of Greenwich is already tomorrow in UTC. Every day this
    // app shows is a local day, so a file stamped tomorrow would contradict the
    // history it holds.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 24, 20, 28)); // 24 Jul, 20:28 local
    expect(stamped('backup', 'json')).toBe('belt-control-backup-2026-07-24.json');
  });

  it('zero-pads, so the names sort chronologically in a file listing', () => {
    expect(stamped('sessions', 'csv', new Date(2026, 0, 5, 9).getTime())).toBe(
      'belt-control-sessions-2026-01-05.csv'
    );
  });
});
