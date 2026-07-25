import { settings, updateSettings } from '../state/settings.js';
import { todayTotals } from '../state/session.js';

/**
 * One ratio against one limit. A meter on a same-ramp track — not a ring, not a
 * two-slice pie, and not three competing rings.
 */
export function GoalMeter() {
  const goal = settings.value.goalMinutes;
  const done = todayTotals.value.minutes;
  const pct = goal > 0 ? Math.min(100, (done / goal) * 100) : 0;

  const editGoal = () => {
    const answer = prompt('Daily goal, in minutes', String(goal));
    if (answer == null) return;
    const n = Number(answer);
    if (Number.isFinite(n) && n > 0) updateSettings({ goalMinutes: Math.round(n) });
  };

  return (
    <div class="meter">
      <div class="meter-head">
        <span>{Math.round(done)} of {goal} min</span>
        <button class="meter-goal-btn" onClick={editGoal}>
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
    </div>
  );
}
