import { useEffect, useRef } from 'preact/hooks';
import { live } from '../state/telemetry.js';
import { treadRate, TREAD_PITCH_PX, TREAD_CYCLE_MS } from '../lib/tread.js';

/**
 * A band of tread slats that scrolls at the speed the belt says it is running.
 *
 * Not decoration with a speed-shaped animation bolted on: the strip is driven by the
 * pad's own reported speed, so it is one more readout of the same telemetry the numbers
 * come from. It holds still when the belt is stopped, holds still when the pad has not
 * reported a speed at all, and glides to a halt on its own as a belt coasting down
 * reports smaller and smaller numbers. Nothing in it is a claim the app has not been
 * told — which is the only reason it is allowed on a screen this careful about what it
 * asserts. See `treadRate` for the floor it shares with `isMoving`.
 *
 * `aria-hidden`, and deliberately: speed is already on screen as a number and in the
 * chip's label, and a scrolling texture announced to a screen reader is noise rather
 * than a third statement of it.
 */
export function TreadStrip({ variant }: { variant?: 'ambient' }) {
  const belt = useRef<HTMLDivElement>(null);
  const anim = useRef<Animation | null>(null);
  const rate = treadRate(live.value.speedKmh);

  // One animation for the life of the component, paused until there is something to
  // report. Restarting it per frame is what this exists to avoid.
  useEffect(() => {
    const el = belt.current;
    if (!el || typeof el.animate !== 'function') return;
    const a = el.animate(
      [{ transform: 'translateX(0)' }, { transform: `translateX(-${TREAD_PITCH_PX}px)` }],
      { duration: TREAD_CYCLE_MS, iterations: Infinity, easing: 'linear' }
    );
    a.pause();
    anim.current = a;
    return () => {
      a.cancel();
      anim.current = null;
    };
  }, []);

  useEffect(() => {
    const a = anim.current;
    if (!a) return;
    // Reduced motion is honoured here rather than in tokens.css: that blanket rule
    // reaches declarative animations only, and this one is scripted. Re-read on every
    // speed change rather than cached at mount, so turning the setting on part-way
    // through a walk takes effect at the next frame instead of the next reload.
    if (rate <= 0 || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      a.pause();
      return;
    }
    a.playbackRate = rate;
    a.play();
  }, [rate]);

  return (
    <div
      class={`tread${variant === 'ambient' ? ' tread-ambient' : ''}`}
      // The gradient period and the animation's travel are the same number by
      // construction, handed to CSS from the module that owns it. Two constants that
      // must agree and are declared apart eventually stop agreeing.
      style={`--tread-pitch:${TREAD_PITCH_PX}px`}
      aria-hidden="true"
    >
      <div class="tread-belt" ref={belt} />
    </div>
  );
}
