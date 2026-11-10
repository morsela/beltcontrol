import { useRef } from 'preact/hooks';
import { settings, updateSettings } from '../state/settings.js';
import { driver } from '../state/connection.js';
import { trustFor } from '../state/telemetry.js';
import { todayTotals } from '../state/session.js';
import { availableMetrics, cycleMetric, metricValue, metricUnit } from '../lib/metrics.js';
import { trackEvent } from '../lib/analytics.js';

/**
 * The one number the screen leads with, at ~72px so it reads from arm's length
 * while you are actually walking.
 *
 * Tapping cycles the primary metric, skipping anything this protocol cannot
 * report — so the control never lands on a permanent em dash.
 */
export function Hero({ onLongPress }: { onLongPress?: () => void }) {
  const trust = driver.value ? trustFor(driver.value.id) : null;
  const available = availableMetrics(trust);
  const key = available.includes(settings.value.heroMetric) ? settings.value.heroMetric : 'time';
  const day = todayTotals.value;
  const u = settings.value.units;

  // Held in a ref, not a local: this component re-renders every second while a
  // session is running, and a plain `let` would be a fresh binding by the time
  // pointerup fires — leaving the pending timer uncancellable, so an ordinary tap
  // could drop you into ambient mode.
  const timer = useRef<number | undefined>(undefined);
  const fired = useRef(false);

  const startPress = () => {
    if (!onLongPress) return;
    fired.current = false;
    timer.current = window.setTimeout(() => {
      fired.current = true;
      onLongPress();
    }, 550);
  };
  const endPress = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = undefined;
  };

  return (
    <>
      <button
        class="hero"
        onClick={() => {
          // A long press already acted; don't also cycle the metric on the way out.
          if (fired.current) {
            fired.current = false;
            return;
          }
          const next = cycleMetric(key, available);
          updateSettings({ heroMetric: next });
          trackEvent('hero_metric_changed', { metric: next });
        }}
        onPointerDown={startPress}
        onPointerUp={endPress}
        onPointerLeave={endPress}
        onContextMenu={(e) => e.preventDefault()}
        aria-label={`${metricValue(key, day, u)} ${metricUnit(key, u)}. Tap to change the metric.`}
      >
        <span class="value tnum">{metricValue(key, day, u)}</span>
        <span class="unit">{metricUnit(key, u)}</span>
        {/* No "this session" line under it any more. The tiles a few lines down state
            the session's time and distance, and this said both again 150px above them. */}
      </button>
      {/* Says what the number is as well as that it changes. Ambient mode has a button
          of its own in the top bar now, so the long press is a shortcut and not the
          thing a 11px line has to teach. */}
      {available.length > 1 && <p class="hero-hint">Tap the number to show something else</p>}
    </>
  );
}
