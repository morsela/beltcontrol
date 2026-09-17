// Everything this app keeps in localStorage: what the keys are, and the four ways it
// touches them.
//
// Two things used to be spread across the app and are collected here.
//
// The keys were declared in the modules that own them — `settings.ts`, `session.ts`,
// `DesktopOnlyNotice.tsx` — and then written out a second time as string literals in
// `Recovery.tsx`, which needs the whole set to dump and to clear. That second list was
// kept in step by hand, so a fifth stored key added anywhere would have dropped
// silently out of both the rescue download and the clear button. Those are the last two
// controls in the app that still work when everything else has failed, and neither can
// afford to be quietly incomplete. `STORAGE_KEYS` is now the one declaration and
// `Recovery` reads the values off it.
//
// The access wrappers were seven copies of the same try/catch. Every one of them is
// needed — `localStorage` throws outright in a browser with site data blocked, and
// `setItem` throws on quota in private mode — and the app's answer is always the same:
// carry on without the stored value. A store that forgets is a worse app; a store that
// throws is no app at all.

/**
 * Every key this app writes. The `wp.` prefix and the version suffix are both
 * historical and both load-bearing: the prefix predates the rename to Belt Control and
 * changing it now would orphan every walk already recorded in somebody's browser, and
 * the suffix is what a future migration would move off.
 */
export const STORAGE_KEYS = {
  sessions: 'wp.sessions.v1',
  openSession: 'wp.session.open.v1',
  settings: 'wp.settings.v1',
  desktopNotice: 'wp.desktopNotice.dismissed.v1',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/**
 * The same keys as a list, for the recovery screen — the one caller that wants all of
 * them rather than one by name, because it is dumping and clearing the lot.
 *
 * Derived rather than written out again, which is the whole point: a key added above
 * is in the rescue dump and the clear button without anybody remembering to add it.
 */
export const ALL_STORAGE_KEYS: readonly StorageKey[] = Object.values(STORAGE_KEYS);

/** The stored string, or `null` when there is nothing there or storage is unreachable. */
export function readRaw(key: StorageKey): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // site data blocked — the app runs, it just does not remember
  }
}

/** Store a string, or carry on without having stored it. */
export function writeRaw(key: StorageKey, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode / quota — the app still works, it just forgets */
  }
}

export function removeStored(key: StorageKey): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* nothing more to try */
  }
}

/**
 * The parsed contents of `key`, as `unknown` — because that is exactly what it is.
 *
 * `undefined` means there is nothing to read: no value, storage unreachable, or bytes
 * that are not JSON at all. It is deliberately distinct from a stored `null`, which is
 * a value the app did write and which a caller's sanitiser should get the chance to
 * reject on its own terms. Callers hand whatever comes back to a sanitiser rather than
 * casting it; nothing in here vouches for the shape.
 */
export function readJson(key: StorageKey): unknown {
  const raw = readRaw(key);
  if (raw == null || raw === '') return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined; // truncated by a full disk, or written by a build that is gone
  }
}

export function writeJson(key: StorageKey, value: unknown): void {
  writeRaw(key, JSON.stringify(value));
}
