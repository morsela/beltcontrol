import { useRef } from 'preact/hooks';
import { settings, updateSettings } from '../state/settings.js';
import { driver } from '../state/connection.js';
import { trustFor } from '../state/telemetry.js';
import { todayTotals, currentSession } from '../state/session.js';
import { availableMetrics, cycleMetric, metricValue, METRIC_UNIT } from '../lib/metrics.js';
import { fmtDuration, fmtMiles } from '../lib/format.js';

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
  const session = currentSession.value;

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
          updateSettings({ heroMetric: cycleMetric(key, available) });
        }}
        onPointerDown={startPress}
        onPointerUp={endPress}
        onPointerLeave={endPress}
        onContextMenu={(e) => e.preventDefault()}
        aria-label={`${metricValue(key, day)} ${METRIC_UNIT[key]}. Tap to change the metric.`}
      >
        <span class="value tnum">{metricValue(key, day)}</span>
        <span class="unit">{METRIC_UNIT[key]}</span>
        {session && (
          <span class="sub tnum">
            This session {fmtDuration(Math.round(session.activeMs / 1000))}
            {session.trust.distKm === 'ok' && session.distKm > 0
              ? ` · ${fmtMiles(session.distKm)} mi`
              : ''}
          </span>
        )}
      </button>
      {available.length > 1 && <p class="hero-hint">tap to change · hold for ambient mode</p>}
    </>
  );
}
