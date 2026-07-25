/**
 * Sits at the bottom of every screen, not behind an About tab.
 *
 * The point of a trademark disclaimer is that nobody can plausibly claim they
 * were confused about who made this, so it has to be somewhere a user actually
 * passes — a link they never click disclaims nothing. It is muted and short
 * enough to scroll past, which is the whole design brief.
 */
export function Disclaimer() {
  return (
    <footer class="disclaimer">
      <p>
        Belt Control is an independent project. It is not affiliated with, endorsed by, or
        sponsored by Beijing KingSmith Technology Co., Ltd. WalkingPad<sup>®</sup> and
        KingSmith<sup>®</sup> are trademarks of that company, used here only to say which
        treadmills this app can talk to.
      </p>
    </footer>
  );
}
