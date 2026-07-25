import { driver, connected, nudgeSpeed, setTarget, running } from '../state/connection.js';
import { settings } from '../state/settings.js';
import { live } from '../state/telemetry.js';
import { toMph, toKmh, fmtMph } from '../lib/format.js';

const PRESET_LABELS = ['slow', 'desk', 'brisk'];

/**
 * The tactile centre of the screen.
 *
 * Steppers move 0.2 mph (0.32 km/h) per press, comfortably inside the 0.5 km/h
 * safety limit — but stepping from 1.2 to 3.0 mph that way is nine presses, so the
 * three presets exist because desk walkers live at two or three fixed speeds.
 */
export function SpeedControl() {
  const d = driver.value;
  const canSpeed = connected.value && (d?.capabilities.speed ?? false);
  const target = settings.value.targetKmh;
  const actual = live.value.speedKmh;

  // Only worth showing while the belt is still ramping toward the setpoint.
  const ramping =
    running.value && actual != null && Math.abs(actual - target) > 0.15 && actual > 0.05;

  const atMin = d != null && target <= d.minSpeedKmh + 1e-9;
  const atMax = d != null && target >= d.maxSpeedKmh - 1e-9;

  return (
    <div class="card">
      <div class="speed-row">
        <button
          class="speed-btn"
          disabled={!canSpeed || atMin}
          onClick={() => void nudgeSpeed(-1)}
          aria-label="Slower"
        >
          &minus;
        </button>

        <div class="speed-readout">
          <span class="v tnum">{toMph(target).toFixed(1)}</span>
          <span class="k">target mph</span>
          {ramping && <span class="actual tnum">now {fmtMph(actual)}</span>}
        </div>

        <button
          class="speed-btn"
          disabled={!canSpeed || atMax}
          onClick={() => void nudgeSpeed(+1)}
          aria-label="Faster"
        >
          +
        </button>
      </div>

      <div class="presets">
        {settings.value.presetsMph.map((mph, i) => {
          const isActive = Math.abs(toMph(target) - mph) < 0.05;
          return (
            <button
              class="preset"
              key={mph}
              aria-pressed={isActive}
              disabled={!canSpeed}
              onClick={() => void setTarget(toKmh(mph))}
            >
              <span class="p-v tnum">{mph.toFixed(1)}</span>
              <span class="p-k">{PRESET_LABELS[i] ?? 'mph'}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
