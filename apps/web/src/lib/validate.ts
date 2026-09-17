// Validation primitives shared by everything that reads untrusted input.
//
// "Untrusted" here means what it means everywhere else in this app: not that an
// attacker is assumed — same-origin storage is reachable only by this app — but that
// *this app* wrote it, across versions, possibly interrupted by a full disk or a crash
// mid-write, and that a hand-editable backup file lands in the same code paths.

/**
 * A plain object, which is the shape every sanitiser has to establish before it can
 * read a field off whatever it was handed.
 *
 * Arrays are excluded deliberately. `typeof [] === 'object'` and `[] !== null`, so the
 * obvious spelling of this guard waves an array through, and every `v.someField` after
 * it then reads `undefined` off it rather than failing — a stored array would validate
 * as a settings object with no settings in it.
 *
 * It lived in three modules as three identical copies: `settings.ts`, `session.ts` and
 * `backup.ts` — the last of which already imports both sanitisers from the other two
 * and then kept its own copy of the primitive underneath them.
 */
export const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
