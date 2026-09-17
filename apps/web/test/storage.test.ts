import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ALL_STORAGE_KEYS,
  STORAGE_KEYS,
  readJson,
  readRaw,
  removeStored,
  writeJson,
  writeRaw,
} from '../src/lib/storage.js';

const KEY = STORAGE_KEYS.settings;

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('the key registry', () => {
  it('lists every declared key, so the recovery screen cannot miss one', () => {
    // This is the whole reason the registry exists. `Recovery` dumps and clears
    // `ALL_STORAGE_KEYS`; it used to hold a hand-written second copy of the list, so a
    // key added elsewhere in the app silently dropped out of both the rescue download
    // and the clear button — the last two controls that work once everything else has.
    expect([...ALL_STORAGE_KEYS].sort()).toEqual(Object.values(STORAGE_KEYS).sort());
  });

  it('keeps the wp. prefix, which is what already-recorded walks are filed under', () => {
    // Renaming these orphans every walk in somebody's browser. The app was called
    // something else when they were written and the keys are not free to follow.
    for (const k of ALL_STORAGE_KEYS) expect(k).toMatch(/^wp\./);
  });
});

describe('readJson', () => {
  it('round-trips through writeJson', () => {
    writeJson(KEY, { goalMinutes: 45 });
    expect(readJson(KEY)).toEqual({ goalMinutes: 45 });
  });

  it('answers undefined for a key that was never written', () => {
    expect(readJson(KEY)).toBeUndefined();
  });

  it('answers undefined for bytes that are not JSON', () => {
    // A write interrupted by a full disk leaves exactly this.
    writeRaw(KEY, '{"goalMinutes":4');
    expect(readJson(KEY)).toBeUndefined();
  });

  it('answers undefined for an empty value', () => {
    writeRaw(KEY, '');
    expect(readJson(KEY)).toBeUndefined();
  });

  it('distinguishes a stored null from nothing stored', () => {
    // Not a distinction for its own sake: `restoreOpenSession` returns quietly when
    // there is nothing to recover, but hands a value the app actually wrote to
    // `sanitizeSession` so it can be rejected *and reported* like any other bad record.
    writeRaw(KEY, 'null');
    expect(readJson(KEY)).toBeNull();
  });
});

describe('when the browser refuses storage', () => {
  /** Site data blocked: every accessor throws rather than returning null. */
  function blockStorage() {
    for (const method of ['getItem', 'setItem', 'removeItem'] as const) {
      vi.spyOn(Storage.prototype, method).mockImplementation(() => {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      });
    }
  }

  it('reads as absent rather than throwing', () => {
    blockStorage();
    expect(readRaw(KEY)).toBeNull();
    expect(readJson(KEY)).toBeUndefined();
  });

  it('swallows a refused write', () => {
    // Private mode rejects setItem on quota. The app still works, it just forgets —
    // and a walk that is not remembered must not be a walk that cannot be taken.
    blockStorage();
    expect(() => writeRaw(KEY, '1')).not.toThrow();
    expect(() => writeJson(KEY, { goalMinutes: 45 })).not.toThrow();
  });

  it('swallows a refused remove', () => {
    blockStorage();
    expect(() => removeStored(KEY)).not.toThrow();
  });
});

describe('removeStored', () => {
  it('leaves nothing behind for readJson to find', () => {
    writeJson(KEY, { goalMinutes: 45 });
    removeStored(KEY);
    expect(readJson(KEY)).toBeUndefined();
  });
});
