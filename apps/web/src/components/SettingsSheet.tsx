import { useState } from 'preact/hooks';
import { HARD_MAX_KMH, HARD_MIN_KMH } from '@beltcontrol/belt-drivers';
import { Sheet } from './Sheet.js';
import { settings, updateSettings, type Settings } from '../state/settings.js';
import { speedUnit, toSpeed, type Units } from '../lib/format.js';
import { trackEvent } from '../lib/analytics.js';

/** What the three preset chips are called, in order. Shared with SpeedControl. */
export const PRESET_LABELS = ['slow', 'desk', 'brisk'];

const HERO_LABELS: Record<Settings['heroMetric'], string> = {
  time: 'Time walked today',
  distance: 'Distance today',
  steps: 'Steps today',
  kcal: 'Calories today',
};

/**
 * Every preference the app keeps, in one place.
 *
 * They used to be reachable only from wherever each happened to be shown: units from a
 * link at the foot of the speed card, the goal from two words beside the meter, the
 * hero metric by tapping the hero — and the speed presets from nowhere at all, short of
 * editing a backup file by hand. Those shortcuts all still work; this is the place to
 * look when you do not already know where one of them lives.
 *
 * Nothing here is written until Save. A half-typed preset is not a number to hand a
 * chip that sets a treadmill's speed, and "3." on the way to "3.5" would be one.
 */
export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const s = settings.value;
  const [units, setUnits] = useState<Units>(s.units);
  const [goal, setGoal] = useState(String(s.goalMinutes));
  const [hero, setHero] = useState(s.heroMetric);
  // Both lists are held, each as typed, so switching units mid-edit shows the other
  // list rather than a conversion of this one — they are separate lists on purpose,
  // because 1.2 mph is 1.93 km/h and nobody's desk speed is 1.9.
  const [mph, setMph] = useState(() => s.presetsMph.map((p) => p.toFixed(1)));
  const [kmh, setKmh] = useState(() => s.presetsKmh.map((p) => p.toFixed(1)));

  const shown = units === 'metric' ? kmh : mph;
  const setShown = units === 'metric' ? setKmh : setMph;

  // The app's own speed envelope, in the unit on screen. A preset outside it could
  // never be sent — `setTarget` clamps to the connected pad's range, which sits inside
  // this one — so it is refused here, where the reason can be given.
  const lo = Math.ceil(toSpeed(HARD_MIN_KMH, units) * 10) / 10;
  const hi = Math.floor(toSpeed(HARD_MAX_KMH, units) * 10) / 10;
  const okSpeed = (v: string) => {
    const n = Number(v);
    return v.trim() !== '' && Number.isFinite(n) && n >= lo && n <= hi;
  };

  const goalN = Number(goal);
  const goalOk = Number.isFinite(goalN) && goalN >= 1 && goalN <= 600;
  const presetsOk = mph.every((v) => v.trim() !== '' && Number(v) > 0) &&
    kmh.every((v) => v.trim() !== '' && Number(v) > 0) &&
    shown.every(okSpeed);
  const valid = goalOk && presetsOk;

  const round1 = (v: string) => Math.round(Number(v) * 10) / 10;

  const save = (e: Event) => {
    e.preventDefault();
    if (!valid) return;
    const patch: Partial<Settings> = {
      units,
      goalMinutes: Math.round(goalN),
      heroMetric: hero,
      presetsMph: mph.map(round1),
      presetsKmh: kmh.map(round1),
    };
    if (units !== s.units) trackEvent('units_changed', { units });
    if (patch.goalMinutes !== s.goalMinutes) {
      trackEvent('goal_changed', { minutes: patch.goalMinutes! });
    }
    updateSettings(patch);
    onClose();
  };

  return (
    <Sheet title="Settings" onClose={onClose}>
      <form onSubmit={save}>
        <div class="field">
          <span class="field-label" id="set-units">Units</span>
          <div class="seg" role="group" aria-labelledby="set-units">
            <button
              type="button"
              class="btn"
              aria-pressed={units === 'imperial'}
              onClick={() => setUnits('imperial')}
            >
              Miles
            </button>
            <button
              type="button"
              class="btn"
              aria-pressed={units === 'metric'}
              onClick={() => setUnits('metric')}
            >
              Kilometres
            </button>
          </div>
        </div>

        <fieldset class="field-group">
          <legend class="field-label">Speed presets ({speedUnit(units)})</legend>
          <div class="field-cols">
            {shown.map((v, i) => (
              <label class="field" key={`${units}-${i}`}>
                <input
                  class="field-input tnum"
                  type="number"
                  inputMode="decimal"
                  min={lo}
                  max={hi}
                  step={0.1}
                  value={v}
                  aria-invalid={!okSpeed(v)}
                  onInput={(e) => {
                    const next = [...shown];
                    next[i] = (e.target as HTMLInputElement).value;
                    setShown(next);
                  }}
                />
                <span class="field-sub">{PRESET_LABELS[i] ?? `preset ${i + 1}`}</span>
              </label>
            ))}
          </div>
          <p class={`note${shown.every(okSpeed) ? '' : ' hint err'}`} style="margin:.5rem 0 0">
            Between {lo.toFixed(1)} and {hi.toFixed(1)} {speedUnit(units)}. Your treadmill
            may allow less, and a preset above its top speed sets its top speed.
          </p>
        </fieldset>

        <label class="field">
          <span class="field-label">Daily goal (minutes)</span>
          <input
            class="field-input tnum"
            type="number"
            inputMode="numeric"
            min={1}
            max={600}
            step={1}
            value={goal}
            aria-invalid={!goalOk}
            onInput={(e) => setGoal((e.target as HTMLInputElement).value)}
          />
        </label>

        <label class="field">
          <span class="field-label">Big number on the Now screen</span>
          <select
            class="field-input"
            value={hero}
            onChange={(e) =>
              setHero((e.target as HTMLSelectElement).value as Settings['heroMetric'])
            }
          >
            {(Object.keys(HERO_LABELS) as Settings['heroMetric'][]).map((k) => (
              <option value={k} key={k}>
                {HERO_LABELS[k]}
              </option>
            ))}
          </select>
          <span class="field-sub">
            Falls back to time on a treadmill that doesn&rsquo;t report the one you pick.
          </span>
        </label>

        <div class="dialog-actions">
          <button type="button" class="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" class="btn primary" disabled={!valid}>
            Save
          </button>
        </div>
      </form>
    </Sheet>
  );
}
