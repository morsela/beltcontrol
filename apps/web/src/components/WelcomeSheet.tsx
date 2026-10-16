import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { Sheet } from './Sheet.js';
import { sessions } from '../state/session.js';
import { STORAGE_KEYS, readRaw, writeRaw } from '../lib/storage.js';
import { trackEvent } from '../lib/analytics.js';

/** The written page this sheet summarises. A real path rather than a hash route, so
 *  the long version is something a crawler can read too — see docs/deploying.md. */
export const ABOUT_PATH = '/what-is-belt-control';

// Shown on its own once, on a first visit. A browser that already holds walks belongs
// to somebody who knows what this is, which covers everyone who used the app before
// the sheet existed. Unreadable storage reads as "not seen", the same safe direction
// DesktopOnlyNotice takes: the cost is seeing a short explanation twice.
const firstVisit = readRaw(STORAGE_KEYS.welcome) !== '1' && sessions.value.length === 0;

/** Open the sheet. Exported so the footer can bring it back on any screen. */
export const welcomeOpen = signal(firstVisit);

// The app mounts this in either layout, and crossing the desktop breakpoint swaps one
// for the other — so "first" is reported once per load, not once per mount.
let firstReported = false;

// Private mode may refuse the write, and then it simply comes back next load.
const markSeen = () => writeRaw(STORAGE_KEYS.welcome, '1');

function close() {
  welcomeOpen.value = false;
  markSeen();
}

/**
 * What Belt Control is, for someone who has just landed on a page full of controls for
 * a machine that is not connected yet.
 *
 * Deliberately short: three things it does, the one thing it needs, and the one safety
 * rule. Everything longer lives on the written page it links to, which is also the
 * copy search engines index — the hash-routed app has no URL of its own to give them.
 *
 * Rendered once at the top of the app rather than by the footer that reopens it, so a
 * first visit that lands on the legal page (which has no footer) still gets it.
 */
export function WelcomeSheet() {
  // From a mount effect rather than at module load: ES imports run before main.tsx
  // installs the analytics provider, so an event fired at import goes nowhere.
  useEffect(() => {
    if (!firstVisit || firstReported) return;
    firstReported = true;
    trackEvent('welcome_shown', { first: true });
  }, []);

  if (!welcomeOpen.value) return null;

  return (
    <Sheet title="Welcome to Belt Control" onClose={close}>
      <p class="welcome-lede">
        A remote control for your walking pad, in a browser tab. It connects to a KingSmith
        or WalkingPad treadmill over Bluetooth — no phone app, no account, nothing to
        install.
      </p>

      <ul class="welcome-list">
        <li>
          <strong>Control the belt.</strong> Start, stop and set the speed from the computer
          you're already working at.
        </li>
        <li>
          <strong>See it as you walk.</strong> Time, distance, steps and calories, as far as
          your treadmill reports them.
        </li>
        <li>
          <strong>Keep a record.</strong> Every walk is saved automatically, with daily
          goals and a 30-day history. It stays in this browser and is never uploaded.
        </li>
      </ul>

      <p class="note">
        You'll need Chrome, Edge or Opera on a computer, or Chrome on Android, and the
        phone app closed — the treadmill talks to one device at a time. Only start the belt
        when you can see it, and keep the treadmill's own stop within reach.
      </p>

      <div class="data-actions" style="margin-top:1rem">
        <button class="btn primary" onClick={close}>
          Get started
        </button>
        {/* Leaving for the long version counts as having seen it, so coming back
            from that page does not open the short one on top of the app again. */}
        <a class="btn" href={ABOUT_PATH} onClick={markSeen}>
          Read more
        </a>
      </div>
    </Sheet>
  );
}

/** The footer's way back to the sheet. A button, not an anchor: it opens a dialog
 *  rather than a page, the same reasoning as `FeedbackLink` beside it. */
export function WelcomeLink() {
  return (
    <button
      class="table-toggle"
      onClick={() => {
        trackEvent('welcome_shown', { first: false });
        welcomeOpen.value = true;
      }}
    >
      What is Belt Control?
    </button>
  );
}
