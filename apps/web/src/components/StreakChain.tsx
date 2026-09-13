import { dailySeries, streak, bestStreak } from '../state/session.js';
import { settings } from '../state/settings.js';

const DAYS = 7;

/**
 * The last seven days as a strip of stickers, with the running streak over it.
 *
 * It is not a third chart. History already answers "am I keeping this up" twice, over
 * thirty days of columns and twenty-six weeks of heatmap; this answers the much
 * smaller question you ask while standing on the belt, which is whether today is about
 * to break something. Seven is the most that can be filled in by eye without counting.
 *
 * It lives in the content column, never in the rail. The rail is what you touch and the
 * column is what you have done — see "Each region reports once" in docs/design.md — and
 * a streak is as accumulated as a figure gets.
 */
export function StreakChain() {
  const goal = settings.value.goalMinutes;
  const week = dailySeries(DAYS);
  const now = streak(goal);
  const best = bestStreak(goal);

  const met = week.map((d) => d.minutes >= goal);
  const metCount = met.filter(Boolean).length;
  // The last cell is today. It gets its own state so the newest sticker is visibly the
  // newest, rather than one more identical circle in a row of them.
  const todayMet = met[met.length - 1] === true;

  return (
    <div class="streak">
      <div class="streak-head">
        <span class="streak-n">
          {now === 0 ? 'No streak yet' : `${now}-day streak`}
        </span>
        {best > 0 && (
          <span class="streak-best tnum">
            best {best}
          </span>
        )}
      </div>

      {/* The strip states nothing the line above and the line below do not already
          say in words, so it is hidden rather than read out as seven list items each
          announcing whether a circle is filled. */}
      <ol class="streak-chain" aria-hidden="true">
        {met.map((isMet, i) => {
          const isToday = i === met.length - 1;
          const cls = !isMet ? 'blank' : isToday ? 'today' : '';
          return (
            <li key={i} class={cls}>
              {isMet && (isToday ? <CheckMark /> : <Star />)}
            </li>
          );
        })}
      </ol>

      <p class="note">
        {todayMet
          ? `${metCount} of the last ${DAYS} days met the goal.`
          : `${metCount} of the last ${DAYS} days met the goal. Meet today's to fill the last one.`}
      </p>
    </div>
  );
}

function Star() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      <path d="M12 2l2.9 6.9 7.1.4-5.5 4.7 1.7 8-6.2-3.7L5.8 22l1.7-8L2 9.3l7.1-.4z" />
    </svg>
  );
}

function CheckMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="3.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}
