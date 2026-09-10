import { useEffect, useRef, useState } from 'preact/hooks';
import { lastFrameAt } from '../state/telemetry.js';
import { shouldPing } from '../lib/pulse.js';
import type { BeltTone } from '../state/connection.js';

/**
 * The belt-state dot, with a ring that ticks once for every frame off the radio.
 *
 * The app's least ordinary property is that the link is real and local: the browser is
 * talking to the treadmill over Bluetooth, with no server anywhere in it. Nothing on
 * screen showed that. The numbers update, but a number that changes looks the same
 * whether it came from a pad two feet away or from a cache, and the chip's label only
 * moves when the belt's *state* changes — a pad happily reporting 3.0 mph for twenty
 * minutes leaves the whole screen still.
 *
 * So the ring is the radio's own heartbeat: one tick per frame ingested. It stops when
 * the frames stop, which is the point — a link that has gone quiet looks quiet, before
 * any timeout has run out and before anything has been declared wrong.
 *
 * Two things it deliberately is not:
 *
 *   - a state. The dot's colour is the belt's business and the label beside it is the
 *     authority on both; the ring says only that something arrived. It is drawn in a
 *     neutral tone for that reason — a ring that borrowed the belt's colours would read
 *     as a fourth belt state.
 *   - an error. Frames stopping is not a failure the app has established, so nothing is
 *     announced and nothing is coloured `bad`. The connection sheet carries the actual
 *     age of the last frame for anyone who wants to know.
 *
 * `aria-hidden` throughout: the tick has no meaning worth interrupting a screen reader
 * once a second to deliver, and the chip already announces every state change.
 */
export function LinkDot({ tone, busy }: { tone: BeltTone; busy: boolean }) {
  const at = lastFrameAt.value;
  const [tick, setTick] = useState(0);
  const lastPingAt = useRef<number | null>(null);

  useEffect(() => {
    // Teardown resets `lastFrameAt` to null, so a reconnect starts ticking again
    // immediately instead of waiting out a gap measured against the old link.
    if (at == null) {
      lastPingAt.current = null;
      // Unmounts the spent ring as well as resetting the gap. It has faded to nothing
      // by then, but "no ring while nothing is connected" should be true of the DOM
      // and not just of what happens to be visible.
      setTick(0);
      return;
    }
    if (!shouldPing(lastPingAt.current, at)) return;
    lastPingAt.current = at;
    setTick((n) => n + 1);
  }, [at]);

  return (
    <span class="link-dot" aria-hidden="true">
      <span class={`dot ${tone}${busy ? ' pulsing' : ''}`} />
      {/* Keyed on the tick so each frame mounts a fresh element and the animation
          restarts from the beginning — the alternative is toggling a class and forcing
          a reflow to do the same job. Nothing is rendered until a frame has actually
          arrived, so a connected-but-silent pad shows no ring rather than one frozen
          at its first keyframe. */}
      {tick > 0 && <span class="dot-ping" key={tick} />}
    </span>
  );
}
