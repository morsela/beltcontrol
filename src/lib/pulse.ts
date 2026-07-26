// When the link indicator is allowed to tick, and how the age of the last frame is
// worded. Both pure, so neither needs a renderer or a real clock to test.

/**
 * Shortest gap between two visible ticks.
 *
 * A classic pad is polled once a second and an FTMS unit notifies two or three times
 * that fast, which is a heartbeat. A pad reassembling fragments can deliver a burst
 * far quicker than that, and a ring restarted every 40 ms is a flicker rather than a
 * sign of life. 240 ms keeps the fastest visible rate at about four a second.
 */
export const PING_MIN_GAP_MS = 240;

/**
 * Whether a frame arriving at `now` should show a tick.
 *
 * A clock that has gone backwards — a system time change, an NTP correction — ticks
 * rather than waits. The alternative is an indicator that silently stops until the
 * clock catches up, which is indistinguishable from a dead link and is the one thing
 * this must not get wrong.
 */
export function shouldPing(
  lastPingAt: number | null,
  now: number,
  minGapMs: number = PING_MIN_GAP_MS
): boolean {
  if (lastPingAt == null) return true;
  if (now < lastPingAt) return true;
  return now - lastPingAt >= minGapMs;
}

/**
 * How long ago the last frame arrived, for the connection sheet.
 *
 * Sub-second precision below a second, because that is the range a healthy link lives
 * in and "0 s ago" would throw away the only thing worth reading there. A negative age
 * — a frame stamped in the future by a clock change — reads as zero rather than as a
 * negative number nobody can act on.
 */
export function fmtFrameAge(ms: number): string {
  const age = Math.max(0, ms);
  if (age < 1_000) return `${(age / 1_000).toFixed(1)} s ago`;
  if (age < 60_000) return `${Math.round(age / 1_000)} s ago`;
  const mins = Math.round(age / 60_000);
  return `${mins} min ago`;
}
