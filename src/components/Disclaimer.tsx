import { FeedbackLink } from './FeedbackSheet.js';

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
 */
export function Disclaimer() {
  return (
    <footer class="disclaimer">
      <p>
        <strong>Belt Control commands a motorised treadmill.</strong> Only start it when you can
        see the belt, and stop it with the treadmill's own controls or safety key rather than
        relying on this app — a Bluetooth link can drop while the belt keeps running. Provided
        without warranty; you use it at your own risk.
      </p>
      <p>
        Belt Control is an independent project. It is not affiliated with, endorsed by, or
        sponsored by Beijing KingSmith Technology Co., Ltd. WalkingPad<sup>®</sup> and
        KingSmith<sup>®</sup> are trademarks of that company, used here only to say which
        treadmills this app can talk to.
      </p>
      <p class="disclaimer-links">
        <a href="#/legal">Safety, terms &amp; privacy</a>
        <FeedbackLink />
      </p>
    </footer>
  );
}
