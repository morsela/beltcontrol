import { useState } from 'preact/hooks';
import { settings, updateSettings } from '../state/settings.js';
import { todayTotals } from '../state/session.js';
import { Sheet } from './Sheet.js';
import { trackEvent } from '../lib/analytics.js';

/**
 * One ratio against one limit. A meter on a same-ramp track — not a ring, not a
 * two-slice pie, and not three competing rings.
 */
export function GoalMeter() {
  const [editing, setEditing] = useState(false);
  const goal = settings.value.goalMinutes;
  const done = todayTotals.value.minutes;
  const pct = goal > 0 ? Math.min(100, (done / goal) * 100) : 0;

  return (
    <div class="meter">
      <div class="meter-head">
        <span>{Math.round(done)} of {goal} min</span>
        <button class="meter-goal-btn" onClick={() => setEditing(true)}>
          {pct >= 100 ? 'goal met' : 'edit goal'}
        </button>
      </div>
      <div
        class="meter-track"
        role="progressbar"
        aria-valuenow={Math.round(done)}
        aria-valuemin={0}
        aria-valuemax={goal}
        aria-label="Progress toward today's walking goal"
      >
        <div class="meter-fill" style={`width:${pct}%`} />
      </div>

      {editing && <GoalDialog goal={goal} onClose={() => setEditing(false)} />}
    </div>
  );
}

/**
 * Was a `window.prompt`, which cannot validate, cannot be styled, and hands the
 * Escape key to the browser at the one moment the app needs it back.
 */
function GoalDialog({ goal, onClose }: { goal: number; onClose: () => void }) {
  const [value, setValue] = useState(String(goal));

  const n = Number(value);
  const valid = Number.isFinite(n) && n >= 1 && n <= 600;

  const save = (e: Event) => {
    e.preventDefault();
    if (!valid) return;
    updateSettings({ goalMinutes: Math.round(n) });
    trackEvent('goal_changed', { minutes: Math.round(n) });
    onClose();
  };

  return (
    <Sheet title="Daily goal" onClose={onClose}>
      <form onSubmit={save}>
        <label class="field">
          <span class="field-label">Minutes per day</span>
          <input
            class="field-input tnum"
            type="number"
            inputMode="numeric"
            min={1}
            max={600}
            step={1}
            value={value}
            onInput={(e) => setValue((e.target as HTMLInputElement).value)}
          />
        </label>
        <p class="note">Used by the meter here, the streak, and the goal line on History.</p>
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
