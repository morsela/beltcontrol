import { sessions, currentSession, bestStreak } from '../state/session.js';
import { settings } from '../state/settings.js';
import { badgesEarnedToday } from '../lib/badges.js';

/**
 * A sticker earned today, under the day's walks.
 *
 * Renders nothing on an ordinary day, which is most of them — and that is the point.
 * It is a line in the register saying what today produced, not a banner that goes off
 * while somebody is on a moving belt. Ambient mode makes the same argument for itself
 * in docs/design.md: this app sits in peripheral vision for hours, and anything that
 * demands attention had better be Stop.
 *
 * When a day somehow earns two, both are named in one line rather than stacked: the
 * card underneath is a list of walks, and two rosettes over it would outweigh it.
 */
export function NewSticker() {
  const all = [...sessions.value, ...(currentSession.value ? [currentSession.value] : [])];
  const earned = badgesEarnedToday(all, bestStreak(settings.value.goalMinutes));
  if (earned.length === 0) return null;

  const names = earned.map((b) => b.name);
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

  return (
    <p class="badge-new" role="status">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.9"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="12" cy="9" r="6" />
        <path d="M8.5 14.5L7 22l5-2.5L17 22l-1.5-7.5" />
      </svg>
      New sticker{earned.length > 1 ? 's' : ''}: {list}
    </p>
  );
}
