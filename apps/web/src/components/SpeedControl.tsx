import type { ComponentChildren } from 'preact';
import { driver, connected, nudgeSpeed, setTarget, running } from '../state/connection.js';
import { settings, updateSettings } from '../state/settings.js';
import { trackEvent } from '../lib/analytics.js';
import { live, isMoving } from '../state/telemetry.js';
import { isDesktop } from '../lib/viewport.js';
import { toSpeed, fromSpeed, fmtSpeed, speedUnit, distNoun } from '../lib/format.js';

const PRESET_LABELS = ['slow', 'desk', 'brisk'];

/**
 * The tactile centre of the screen.
 *
 * Steppers move 0.2 mph (0.32 km/h) per press — 0.5 km/h for a walker in metric — which
 * is inside the 0.5 km/h safety limit either way. But stepping from 1.2 to 3.0 mph that
 * way is nine presses, so the three presets exist because desk walkers live at two or
 * three fixed speeds.
 *
 * The units switch lives at the foot of this card because this is where the unit is
 * first seen and most felt: the number here is the one that has to match the pad's own
 * display. It is the whole app's setting, not this card's — distances follow it too.
 *
 * `lead` is rendered flush against the top edge of the card, ahead of the steppers.
 * It exists for the tread strip in the desktop rail, which has no hero card to sit on
 * up there — the strip belongs above the speed it is a readout of, not floating in a
 * card of its own.
 */
export function SpeedControl({ lead }: { lead?: ComponentChildren }) {
  const d = driver.value;
  const canSpeed = connected.value && (d?.capabilities.speed ?? false);
  const target = settings.value.targetKmh;
  const actual = live.value.speedKmh;
  const u = settings.value.units;
  const other = u === 'metric' ? 'imperial' : 'metric';
  const presets = u === 'metric' ? settings.value.presetsKmh : settings.value.presetsMph;

  // Only worth showing while the belt is still ramping toward the setpoint.
  const ramping =
    running.value && actual != null && Math.abs(actual - target) > 0.15 && actual > 0.05;

  // In the desktop rail this is a standing readout rather than a ramp indicator,
  // because there it is the only place the speed the belt *reports* is written down —
  // the "mph now" tile went to Today with the rest of the numbers, and Today reports
  // the day, not the second. Two figures that used to sit in separate cards saying a
  // bare `3.0` eighty pixels apart are now adjacent and labelled, which is what the
  // pair actually needed: they differ, and the difference is the interesting part.
  // It also keeps `TreadStrip`'s `aria-hidden` honest — the strip is allowed to be
  // decoration to a screen reader only for as long as the number is stated in text.
  // On a phone the tile above is still saying it, so there it stays a ramp indicator.
  const showActual = actual != null && (ramping || (isDesktop.value && isMoving.value));

  const atMin = d != null && target <= d.minSpeedKmh + 1e-9;
  const atMax = d != null && target >= d.maxSpeedKmh - 1e-9;

  return (
    <div class="card">
      {lead}
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
          <span class="v tnum">{fmtSpeed(target, u)}</span>
          <span class="k">target {speedUnit(u)}</span>
          {showActual && <span class="actual tnum">now {fmtSpeed(actual, u)}</span>}
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
        {presets.map((speed, i) => {
          const isActive = Math.abs(toSpeed(target, u) - speed) < 0.05;
          return (
            <button
              class="preset"
              key={speed}
              aria-pressed={isActive}
              disabled={!canSpeed}
              onClick={() => void setTarget(fromSpeed(speed, u))}
            >
              <span class="p-v tnum">{speed.toFixed(1)}</span>
              <span class="p-k">{PRESET_LABELS[i] ?? speedUnit(u)}</span>
            </button>
          );
        })}
      </div>

      {/* Never disabled: it changes what the screen says, not what the belt does, and
          somebody deciding whether this app is for them wants it before they connect. */}
      <button
        class="table-toggle units-toggle"
        onClick={() => {
          updateSettings({ units: other });
          trackEvent('units_changed', { units: other });
        }}
      >
        Switch to {speedUnit(other)} and {distNoun(other)}
      </button>
    </div>
  );
}
