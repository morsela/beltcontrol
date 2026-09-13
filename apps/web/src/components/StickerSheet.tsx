import type { JSX } from 'preact';
import { sessions, currentSession, bestStreak } from '../state/session.js';
import { settings } from '../state/settings.js';
import { badgeStates, nextBadge, type BadgeId } from '../lib/badges.js';

/** Four fills, cycled by position, so no two neighbours in a row match. */
const FILLS = ['sage', 'rose', 'mustard', 'slate'] as const;

/**
 * The badge sheet: six stickers, the earned ones stuck on and the rest still outlines.
 *
 * Every sticker is named in text under its drawing rather than only drawn. A picture
 * of a bird is not the words "Early Bird" to anyone who cannot see it, and an icon-only
 * grid would be six unlabelled circles to a screen reader — the same argument the
 * status dots make for always shipping a label beside the colour.
 *
 * What earns each one, and why none of them depend on distance or calories, is in
 * src/lib/badges.ts.
 */
export function StickerSheet() {
  const goal = settings.value.goalMinutes;
  // The walk in progress counts. A sticker earned at minute sixty of a walk should
  // appear at minute sixty, not after the belt stops.
  const all = [...sessions.value, ...(currentSession.value ? [currentSession.value] : [])];
  const states = badgeStates(all, bestStreak(goal));
  const next = nextBadge(states);
  const earnedCount = states.filter((b) => b.earned).length;

  return (
    <>
      <ul class="stickers">
        {states.map((b, i) => (
          <li key={b.id}>
            <div
              class={`sticker${b.earned ? '' : ' locked'}`}
              data-fill={b.earned ? FILLS[i % FILLS.length] : undefined}
              aria-hidden="true"
            >
              <BadgeIcon id={b.id} />
            </div>
            <span class={`sticker-name${b.earned ? ' earned' : ''}`}>{b.name}</span>
          </li>
        ))}
      </ul>
      <p class="note" style="margin-top:.75rem">
        {earnedCount} of {states.length}
        {next ? `. Next is ${next.name} — ${lowerFirst(next.how)}.` : '. The sheet is full.'}
      </p>
    </>
  );
}

/** "Walk before 7 AM" reads wrong mid-sentence; "walk before 7 AM" does. */
const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * One drawing per badge, all on the same 24px grid and all stroked rather than filled,
 * so they stay legible at the 52% of a 4.25rem circle the sheet gives them and recolour
 * with the sticker ink in both themes.
 */
function BadgeIcon({ id }: { id: BadgeId }): JSX.Element {
  // The sticker itself carries aria-hidden and the name is given as text beside it,
  // so the drawing needs no accessible attributes of its own.
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 1.9,
    'stroke-linecap': 'round' as const,
    'stroke-linejoin': 'round' as const,
    focusable: 'false',
  };

  switch (id) {
    // A sun just clear of the horizon.
    case 'early-bird':
      return (
        <svg {...common}>
          <path d="M3 18h18" />
          <path d="M12 5v3M5.6 8.6l2 2M18.4 8.6l-2 2M2.5 15h3M18.5 15h3" />
          <path d="M7.5 18a4.5 4.5 0 0 1 9 0" />
        </svg>
      );
    // A crescent with one star.
    case 'night-owl':
      return (
        <svg {...common}>
          <path d="M20 14.5A8 8 0 0 1 9.5 4a7.5 7.5 0 1 0 10.5 10.5z" />
          <path d="M17 3.5l.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8z" />
        </svg>
      );
    // A clock reading a full hour.
    case 'long-haul':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 6.5V12l4 2" />
        </svg>
      );
    // Two overlapping laps.
    case 'double-day':
      return (
        <svg {...common}>
          <circle cx="9" cy="12" r="5.5" />
          <circle cx="15" cy="12" r="5.5" />
        </svg>
      );
    // A flame, the one shape a run of days already reads as.
    case 'week-straight':
      return (
        <svg {...common}>
          <path d="M12 2.5c1.2 4.2 5 5.3 5 9.8a5 5 0 0 1-10 0c0-2 1-3.2 2-4.2 0 2 1 3 2 3 0-3.1-1-6.2 1-8.6z" />
        </svg>
      );
    // A trophy.
    case 'century':
      return (
        <svg {...common}>
          <path d="M8 21h8M12 17.5V21M7 3.5h10v5a5 5 0 0 1-10 0v-5z" />
          <path d="M7 5.5H4v1.5a3 3 0 0 0 3 3M17 5.5h3V7a3 3 0 0 1-3 3" />
        </svg>
      );
  }
}
