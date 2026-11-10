import { FeedbackLink } from './FeedbackSheet.js';
import { WelcomeLink } from './WelcomeSheet.js';

/**
 * Sits at the bottom of every screen, not behind an About tab.
 *
 * The point of a disclaimer is that nobody can plausibly claim they never saw it,
 * so it has to be somewhere a user actually passes — a link they never click
 * disclaims nothing. It is muted and short enough to scroll past, which is the
 * whole design brief.
 *
 * Two sentences, in this order on purpose. The safety one goes first because it is
 * the only line here that describes a way to get hurt; the trademark one is second
 * because being mistaken for KingSmith is a smaller problem than being thrown off a
 * belt. Everything else — the full terms, privacy and licence — lives on the legal
 * page, which is what the link is for. Suppressed on that page by the router: the
 * page says all of this at length, and twice on one screen reads as an accident.
 *
 * A bare anchor like TabBar's, not an onClick — the hash is the router's input and
 * app.tsx already listens for `hashchange`. Setting the signal here as well would
 * both duplicate that and import app.js back into a component app.js imports.
 *
 * Feedback shares that last row for the same reason the legal link is in it: the
 * footer is the one thing under every screen, so there is always a way to say
 * something is wrong from the screen it is wrong on. It is a button rather than an
 * anchor because it opens a dialog rather than a page — there is no hash for it to
 * put in front of the router. Reports about the connection have a second, closer
 * entry in the connection sheet, beside the log they need.
 *
 * "What is Belt Control?" is the way back to the welcome sheet a first visit opens on
 * its own. It leads the row because it is the one a newcomer is looking for.
 */
export function Disclaimer() {
  return (
    <footer class="disclaimer">
      {/* Cut to what has to be under every screen. It ran to nine lines on a phone, on
          all three tabs, and a block that long is one people learn to stop reading —
          which defeats the only reason it is here. The warranty wording and the full
          trademark statement are on the legal page, one tap away on the row below. */}
      <p>
        <strong>Belt Control runs a motorised treadmill.</strong> Only start it when you can see
        the belt, and keep the treadmill&rsquo;s own stop or safety key within reach: Bluetooth
        can drop while the belt keeps running.
      </p>
      <p>
        An independent project, not affiliated with or endorsed by Beijing KingSmith Technology
        Co., Ltd. WalkingPad<sup>®</sup> and KingSmith<sup>®</sup> are its trademarks.
      </p>
      <p class="disclaimer-links">
        <WelcomeLink />
        <a href="#/legal">Safety, terms &amp; privacy</a>
        <FeedbackLink />
      </p>
    </footer>
  );
}
