/**
 * Safety, terms, privacy and licensing — one page rather than four.
 *
 * Four separate documents is the shape that gets nothing read. The one thing here
 * that genuinely matters is the safety section: this app starts a motorised belt,
 * and the person reading has a treadmill within arm's reach. So safety is first,
 * before the boilerplate, and it is written as instructions rather than as terms.
 *
 * Reached from the footer disclaimer on every screen. Deliberately not a tab — a
 * nav slot spent on legal text is a nav slot not spent on the app, and the footer
 * is already the place a reader looks for this.
 */
import { REPO_URL } from '../lib/links.js';

/**
 * Set this to the jurisdiction whose law governs, e.g. 'England and Wales' or
 * 'the State of California, United States'. Left null until the operator decides,
 * because a governing-law clause naming the wrong place is worse than none: it
 * invites an argument about the clause instead of about the dispute. The section
 * renders only once this is set.
 */
const GOVERNING_LAW: string | null = null;

/** Bumped by hand when the wording below changes in a way a reader should re-read. */
const UPDATED = '25 July 2026';

export function Legal() {
  return (
    <div class="legal">
      <h1 class="page">Legal</h1>
      <p class="page-sub">Safety, terms, privacy and licensing. Last updated {UPDATED}.</p>

      {/* Warn-toned rather than error-toned, and boxed rather than run in with the
          rest: this is the only block on the page that describes a way to get hurt. */}
      <section class="card callout-safety" aria-labelledby="safety">
        <h2 id="safety">Safety</h2>

        <p>
          <strong>
            Belt Control starts, speeds up and stops a motorised treadmill. A moving belt can
            throw someone off it and cause serious injury.
          </strong>{' '}
          Read this part even if you skip the rest.
        </p>

        <ul>
          <li>
            <strong>Only start the belt when you can see it</strong> and the belt and the floor
            behind it are clear of people, pets and objects. The app has no way to know whether
            anyone is standing on the belt, or who.
          </li>
          <li>
            <strong>Do not rely on this app to stop the belt.</strong> Your treadmill's own
            controls are the stop of record: its panel, its remote, its safety key, and the plug
            in the wall. Learn where they are before you step on. A Bluetooth link can drop, a
            browser can suspend a background tab, a laptop can sleep, a battery can die — and in
            every one of those cases the belt keeps running with nothing on this screen able to
            reach it.
          </li>
          <li>
            <strong>Keep the safety key attached</strong> if your treadmill has one. It is the
            only stop on the machine that does not depend on software of any kind.
          </li>
          <li>
            <strong>This is not a safety device</strong> and it is not a medical device. Speed,
            distance, step and calorie figures come from the treadmill itself. On some protocols
            the scaling of those numbers has never been verified against a known reference —
            those are flagged in the app and left out of totals. Do not use any of it for a
            decision that matters medically.
          </li>
          <li>
            <strong>Follow your treadmill manufacturer's own safety instructions.</strong> Where
            they conflict with anything on this page, follow theirs — they know the machine and
            this app does not.
          </li>
          <li>
            If you have a health condition or have not exercised in a while, talk to a doctor
            before using a treadmill.
          </li>
        </ul>

        <h3>What the app does about this</h3>
        <p>
          Starting or resuming the belt always asks for confirmation first. While the belt may be
          moving, Stop is pinned on screen and cannot be scrolled away. Speed moves one step per
          press, within the limit the pad itself enforces. The app does not report a walk as
          started until the treadmill confirms it moved.
        </p>
        <p class="note">
          Those reduce the risk. They do not remove it, and none of them can help if the link
          drops or the phone is in another room.
        </p>
      </section>

      <section class="card" aria-labelledby="terms">
        <h2 id="terms">Terms of use</h2>

        <p>
          Belt Control is a free, independent, open-source project. There is no account, no
          subscription and nothing for sale. By using it you accept these terms; if you do not
          accept them, do not use it.
        </p>

        <h3>No warranty</h3>
        <p>
          Belt Control is provided <strong>"as is", without warranty of any kind</strong>, express
          or implied, including any warranty of merchantability, fitness for a particular purpose
          or non-infringement. It is maintained by volunteers in their own time. Nobody is on
          call, and there is no guarantee it works with your treadmill, keeps working after a
          firmware or browser update, or works at all.
        </p>
        <p>
          The Bluetooth protocols it speaks were worked out by observing traffic, not from any
          manufacturer's specification. Some fields are understood well; others are marked
          unverified in the app precisely because they are not.
        </p>

        <h3>Your treadmill is yours</h3>
        <p>
          You are responsible for your own hardware and for using it safely. Controlling a
          treadmill with third-party software may void its warranty or fall outside its
          manufacturer's terms — that is between you and them, and worth checking before you
          start. You are also responsible for complying with the law where you are.
        </p>

        <h3>Limitation of liability</h3>
        <p>
          To the fullest extent permitted by law, the authors and contributors are not liable for
          any injury, death, property damage, damage to your treadmill, lost data, or any direct,
          indirect, incidental, special or consequential loss arising out of the use of, or
          inability to use, Belt Control — including where the software behaves in a way nobody
          intended or expected.
        </p>
        <p>
          <strong>Nothing on this page excludes or limits liability that cannot lawfully be
          excluded or limited</strong>, which in many countries includes liability for death or
          personal injury caused by negligence, and for fraud. Where a limitation above is held
          unenforceable, the rest still stands. You may also have rights under local consumer law
          that these terms cannot take away.
        </p>

        <h3>Changes</h3>
        <p>
          These terms may change. The date at the top says when they last did, and the full
          history is in the repository — every change is a commit. Continuing to use the app after
          a change means accepting the new version.
        </p>

        {GOVERNING_LAW && (
          <>
            <h3>Governing law</h3>
            <p>
              These terms are governed by the law of {GOVERNING_LAW}, without regard to its
              conflict-of-laws rules. This does not deprive you of the protection of mandatory
              consumer law where you live.
            </p>
          </>
        )}
      </section>

      <section class="card" aria-labelledby="privacy">
        <h2 id="privacy">Privacy</h2>

        <p>
          There is no account, no sign-up and no email address. The parts of this app that know
          anything about your walking never leave your browser.
        </p>

        <h3>Stays on your device</h3>
        <ul>
          <li>
            <strong>Session history and daily totals</strong> — held in your browser's
            <code>localStorage</code>. Never uploaded. Clearing site data deletes it, and so does
            Delete on a session.
          </li>
          <li>
            <strong>Settings</strong> — your goal, units and preferences. Same storage, same rule.
          </li>
          <li>
            <strong>Live telemetry from the treadmill</strong> — speed, distance, steps, state.
            This travels browser-to-treadmill over the local Bluetooth radio and is never sent
            anywhere else. The server ships static files; it has no database and no endpoint that
            could receive telemetry even in principle.
          </li>
          <li>
            <strong>Bluetooth access</strong> — mediated entirely by your browser. You pick the
            device from the browser's own chooser; the app cannot scan for or connect to anything
            you have not picked, and cannot see any other device.
          </li>
        </ul>
        <p class="note">
          Exports are the exception, and only because you asked: Export backup and Export CSV write
          a file wherever you tell your browser to put it. After that it is an ordinary file on
          your machine and this app has no further say in where it goes.
        </p>

        <h3>What is collected</h3>
        <p>
          The site uses <strong>Vercel Web Analytics</strong> to count visits. It records the page
          viewed, the referring site, and coarse technical details — approximate country, browser,
          operating system and device type. It sets <strong>no cookies</strong>, does not track you
          across other sites, and does not build a profile or an advertising identifier.
        </p>
        <p>
          Vercel also hosts the site, and like any web host keeps standard request logs, which
          include IP addresses, for a limited period. Vercel processes both on our behalf as our
          hosting provider. Nothing is sold, and nothing is shared with anyone else.
        </p>
        <p>
          There are no ads, no third-party trackers, no social widgets and no fonts, scripts or
          images loaded from anyone else's server. The content security policy on every response
          blocks outbound connections to other origins outright.
        </p>

        <h3>Your choices</h3>
        <ul>
          <li>Export your history from the History screen, in JSON or CSV, at any time.</li>
          <li>Delete it by clearing site data for this site in your browser, or per session.</li>
          <li>
            Block the analytics beacon with any content blocker — the app is built to work
            normally without it.
          </li>
          <li>
            Run it yourself. It is open source and entirely static; a local copy over{' '}
            <code>http://localhost</code> phones home to nobody.
          </li>
        </ul>
        <p class="note">
          If you are in the UK or the EU: the lawful basis for the analytics described above is
          legitimate interest in understanding aggregate usage of a free tool. To exercise a data
          right, or to ask anything about this section, open an issue on the repository.
        </p>
      </section>

      <section class="card" aria-labelledby="trademarks">
        <h2 id="trademarks">Trademarks and independence</h2>
        <p>
          Belt Control is not affiliated with, endorsed by, or sponsored by Beijing KingSmith
          Technology Co., Ltd. WalkingPad<sup>®</sup> and KingSmith<sup>®</sup> are trademarks of
          that company and appear here only to identify which treadmills this app can talk to,
          which is nominative use. The project uses none of their logos, wordmarks or trade dress,
          takes no payment, carries no advertising, and does not present itself as official or
          supported.
        </p>
        <p>
          <a href={`${REPO_URL}/blob/main/docs/trademarks.md`} rel="noopener noreferrer">
            The full trademark note
          </a>{' '}
          explains where the marks appear and why.
        </p>
      </section>

      <section class="card" aria-labelledby="licence">
        <h2 id="licence">Licence</h2>
        <p>
          Belt Control is licensed under the{' '}
          <a href="https://www.apache.org/licenses/LICENSE-2.0" rel="noopener noreferrer">
            Apache License, Version 2.0
          </a>
          . You may use, modify and redistribute it under those terms, which include the warranty
          disclaimer and liability limitation in sections 7 and 8. If you fork it, keep the
          independence notice rendered.
        </p>
        <p>
          <a href={REPO_URL} rel="noopener noreferrer">
            Source, protocol notes and issues
          </a>{' '}
          are on GitHub. Questions about anything on this page belong there.
        </p>
      </section>

      <p class="note legal-foot">
        This page is written to be read and understood, not to be impressive. It is not legal
        advice.
      </p>
    </div>
  );
}
