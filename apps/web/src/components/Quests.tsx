import type { Session, DayTotal } from '../state/session.js';
import { settings } from '../state/settings.js';
import { questsFor } from '../lib/quests.js';

/**
 * Today's three, ticked or not.
 *
 * No score, deliberately — the reasoning is in src/lib/quests.ts, and it is the same
 * reasoning that keeps an unverified distance out of every total: a number this app
 * invented does not belong in a column of numbers the treadmill sent.
 *
 * The day's sessions and totals are passed in rather than read from the store, so this
 * counts exactly the minutes the goal meter above it counts. Two components folding the
 * same day apart is how a screen ends up stating one figure two ways.
 */
export function Quests({ sessionsToday, day }: { sessionsToday: Session[]; day: DayTotal }) {
  const quests = questsFor(sessionsToday, day, settings.value.goalMinutes);

  return (
    <ul class="quests">
      {quests.map((q) => (
        <li key={q.id} class={`quest${q.done ? ' done' : ''}`}>
          {/* The tick is decoration; "Done" and "not done" ride on the list item's
              own text so the state is never carried by the drawing alone. */}
          <span class="quest-box" aria-hidden="true">
            {q.done && (
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="3.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                focusable="false"
              >
                <path d="M5 12.5l4.5 4.5L19 7" />
              </svg>
            )}
          </span>
          <span class="quest-label">
            {q.label}
            <span class="sr-only">{q.done ? ' — done' : ' — not done'}</span>
          </span>
          {q.progress && <span class="quest-progress tnum">{q.progress}</span>}
        </li>
      ))}
    </ul>
  );
}
