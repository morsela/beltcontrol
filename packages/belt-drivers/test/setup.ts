// Runs the suite's clock twenty times fast.
//
// The drivers pace their own writes with real sleeps — 30 and 60 ms between the 0x1234
// fragments, a settle after a classic mode change, seconds of patience for an answer
// that may not come — and the suite waited every one of them out: about a minute, most
// of it spent asleep. Faking the clock outright is not an option here; it deadlocks
// `attach`, whose handshake is real promises resolving between those sleeps.
//
// So the delays are shortened rather than faked. Every timer still fires, still
// asynchronously, and still in the same order relative to every other timer, because
// they are all divided by the same number: a 60 ms sleep still outlasts a 30 ms one, and
// a 3 s timeout still comes after both. What the tests assert is that order and what was
// written, never how long it took, so nothing they vouch for has changed.
//
// A test that calls `vi.useFakeTimers()` is unaffected — vitest swaps this out for its
// own clock and puts it back afterwards.
const SCALE = 20;

const realSetTimeout = globalThis.setTimeout;

const fast = ((handler: (...args: unknown[]) => void, ms?: number, ...args: unknown[]) =>
  realSetTimeout(handler, (ms ?? 0) / SCALE, ...args)) as unknown as typeof setTimeout;

globalThis.setTimeout = fast;
if (typeof window !== 'undefined') window.setTimeout = fast as unknown as typeof window.setTimeout;
