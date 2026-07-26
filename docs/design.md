# Interface and session design

Why the app looks and behaves the way it does. Read this before changing the UI or the
session logic — most of what looks arbitrary here is load-bearing.

- [The three screens](#the-three-screens)
- [Two layouts](#two-layouts)
- [Dialogs and the Escape key](#dialogs-and-the-escape-key)
- [Design decisions](#design-decisions)
- [Sessions](#sessions)
- [Counter resets](#counter-resets)
- [Field trust](#field-trust)

## Reading storage back

`localStorage` is untrusted input. Not because an attacker is assumed — same-origin
storage is reachable only by this app — but because *this app* wrote it, across
versions, possibly interrupted by a full disk or a crash mid-write.

It used to be read back with a bare cast (`parsed as Session[]`), and one bad record was
enough to take the app down on every load, permanently, with no way back in short of the
devtools:

| Stored record | What happened |
|---|---|
| missing `trust` | `TypeError` in the Today render path, which reads `s.trust.distKm` |
| `distKm: "abc"` | every total `NaN`, for good |

Both read paths — the session list and the in-flight session — now go through
`sanitizeSession`, the same validator the backup import already used. A record that
cannot be placed on the calendar at all (no usable `startedAt`) is dropped and logged;
everything else is coerced into range. Under-trusting is the safe direction, so an
unrecognised protocol yields an all-absent trust map, which keeps that session's numbers
out of every aggregate rather than presenting raw counter values as kilometres.

`App` also holds an error boundary. Validation closes the case that actually happened; the
boundary closes the category, because any render that throws over stored data throws again
on the next load. It offers a retry, a download of the raw stored strings — handed over
without being parsed, so it works even when the data is what the app is choking on — and
only then the option to clear.

## The three screens

Three tiers, each answering one question:

| Screen | Question it answers |
|---|---|
| **Now** | What is the belt doing, and how do I change it? |
| **Today** | What have I done today, and in which sessions? |
| **History** | Am I actually keeping this up? |

Speeds are shown in **mph**. Everything on the wire stays metric — the protocols all speak
km/h — so miles are a display concern only, converted in `src/lib/format.ts`.

## Two layouts

Desktop is the primary target: Web Bluetooth exists in desktop Chromium and nowhere on
iOS at all. The breakpoint is **64rem**, declared once in `src/lib/viewport.ts` and read
from both sides — the shell branches on it in JS and `app.css` branches on it in CSS. If
the two ever disagree the page renders half in each mode, so the media query names the
file above it and a test pins the constant.

**Below 64rem** the layout is unchanged: one column, bottom tab bar, Stop pinned above it.

**At 64rem and up**, Now stops being a destination and becomes a rail:

| Region | Holds |
|---|---|
| Top bar | Wordmark, Today, History — *not* Now |
| Left rail (sticky, own scroll) | Stop, connection, hero, speed, mode |
| Content column | Today or History, and the disclaimer |

Now is not in the nav because it is never absent — a nav entry for something already on
screen is a control that cannot report a state. `#/now` is rewritten to `#/today` rather
than rendered as a page nothing in the nav is current for.

The rail exists so the live numbers hold still while History scrolls, which is the entire
argument for two columns. It is its own scroll container so a short window cannot strand
Stop below the fold. Note that `position: sticky` creates a stacking context whatever its
z-index, and every dialog in the app is born inside the rail — hence the explicit
`z-index` there, without which the content column paints straight through them.

The charts take a `width` prop rather than one fixed viewBox. An SVG scales everything,
so a phone-sized viewBox in a desktop column magnifies the axis text and the goal dashes
along with the bars; callers pass roughly the rendered width to hold 1 unit ≈ 1 px. The
consistency heatmap shows 26 weeks on desktop against 14 on a phone — twice the column
deserves more history, not bigger squares.

## Dialogs and the Escape key

`Esc` does double duty: it stops the belt from anywhere, and it is the universal dismiss
key. Those collided — closing the connection sheet also halted the walk. The rule is now
that **Esc belongs to the topmost dialog when one is open, and to the belt otherwise**,
arbitrated by a counter in `src/state/ui.ts`.

That is only safe because of a second rule: **no dialog may hide Stop**. `Sheet` renders
its own Stop whenever the belt is moving, so the control is on screen for the entire time
the key points elsewhere. It is enforced in the primitive rather than per-dialog, so a
future sheet cannot forget.

`Sheet` declares `aria-modal`, so it owes the keyboard what that implies: focus moves in
on open, Tab cycles inside, focus returns to the opener on close. It focuses the first
control *in the body* — never its own Stop, which would make Enter a way to halt the belt
by accident. Stop must be reachable, not preselected. There is also a visible close
button, because a key is not an affordance.

`window.confirm` and `window.prompt` are gone (`ConfirmDialog`, and the goal editor in
`GoalMeter`). They cannot be styled or validated, they block the event loop, and — the
reason they had to go — they take focus and Escape out of the app's hands at exactly the
moment Escape has somewhere better to be.

## Design decisions

- **The hero number cycles.** Tapping it moves between time, distance, steps and calories —
  *skipping whatever the connected protocol cannot report*. FTMS carries no step count and
  neither the classic nor the `0x1234` frame carries calories, so a fixed six-tile grid
  guaranteed permanent em dashes on every real device. Availability is resolved once, at
  connect time, from `capabilities` plus the trust map in `src/state/telemetry.ts`.
- **The tread strip is a readout, not decoration.** A band of slats above the hero number
  scrolls at the speed the pad reports, driven from the same telemetry the numbers come
  from — so it holds still when the belt is stopped, holds still when the pad has not
  reported a speed *at all*, and glides to a halt on its own as a belt coasting down
  reports smaller numbers. It shares the `MOVING_KMH` floor with `isMoving` rather than
  picking a threshold of its own, because a still belt under a moving strip and a moving
  belt under a still one are the same bug. One animation re-timed by `playbackRate`, not
  restarted per frame: a treadmill reports speed once or twice a second and a restart on
  each report is visible as a stutter. It is squared off and ruled top and bottom, with
  wide slats and narrow gaps, so it cannot be mistaken for the rounded goal meter a few
  rems below — nothing about it reads as a proportion, because it has no end. Reduced
  motion is honoured in `TreadStrip` rather than in `tokens.css`: that blanket rule
  reaches declarative animations only, and this one is scripted. Timing constants live in
  `src/lib/tread.ts`, including the pitch, which the component hands to CSS as
  `--tread-pitch` so the gradient period and the travel cannot drift apart.
- **Three speed presets.** The steppers move 0.2 mph per press to stay inside the
  0.5 km/h safety limit, which makes 1.2 → 3.0 mph nine presses. Desk walkers live at two or
  three fixed speeds, so those get chips.
- **Stop is pinned.** While the belt moves, Stop is fixed above the tab bar on mobile and
  at the top of the rail on desktop, and cannot be scrolled away. `Esc` still works
  everywhere. Dialogs cover it, so dialogs carry their own — see
  [Dialogs and the Escape key](#dialogs-and-the-escape-key). For the same reason
  Disconnect is not styled `danger`: red is reserved for Stop.
- **Pause appears only where it is real.** FTMS is the one protocol with a resumable pause
  (`08 02`, resumed by the same `07` that starts the belt), so the button is gated on
  `capabilities.pause` and disappears again the moment a unit answers "op code not
  supported" — see [Driver 2](protocols.md#driver-2--ftms-00001826). Faking it everywhere
  else with a stop would put a Resume button in front of a belt that had ended its walk.
  It never displaces Stop: it takes a third of the pinned bar to Stop's two thirds, and
  `Esc` stays bound to Stop alone. Resuming gets the same confirmation dialog as starting,
  in ambient mode too — a resume moves a belt exactly as much as a start does.
- **Ambient mode is a button, not only a gesture.** Holding the hero number still works,
  but a long press is no gesture at all on a keyboard, and the hint that it exists is
  hidden on protocols with a single available metric. The `Ambient` button beside the
  connection chip is the discoverable and keyboard-reachable path to the same screen.
- **Ambient mode.** Hold the hero number: full-screen giant readout holding a
  `navigator.wakeLock`, with Stop always visible. Wake Lock is supported in exactly the same
  browsers as Web Bluetooth, so it adds no new requirement. It is deliberately *not* a
  celebration screen — it sits in peripheral vision for hours, so its job is to be legible
  and then ignorable. It is a dark surface under *both* themes — a full-screen white panel
  is the wrong thing to park beside someone working — which makes it the one place that
  cannot draw from `--ink`, near-black in the light theme. It has its own
  `--ambient-bg/-ink/-muted` tokens instead, measured at 17:1 and 7:1 in both themes.
- **The chip's dot carries the radio, not just the belt.** A ring ticks outward once per
  frame ingested, throttled to about four a second so a burst of reassembled fragments
  reads as a heartbeat rather than a flicker. The app's least ordinary property is that
  the link is real and local — browser to treadmill, no server in it — and nothing on
  screen showed it: the label only moves when the belt's *state* changes, so a pad
  happily reporting 3.0 mph for twenty minutes left the whole screen still. The ring is
  deliberately **not** a state and **not** an error. It is drawn in `--muted`, which is
  outside the status palette, so it cannot be read as a fourth thing the dot is saying;
  when frames stop it simply stops, before any timeout has run out and without anything
  being declared wrong. The connection sheet carries the age of the last frame for
  anyone who wants the number, updated by a clock of its own — nothing in the signal
  graph moves when a pad goes silent, which is exactly the case that row exists to show.
- **A failure is never only in the log.** Every status, including one raised while
  connected, renders in a single always-mounted `aria-live` region on Now. A speed write
  that the belt rejects also puts the readout back where it was: the target on screen is
  the target the belt accepted, or it is an error, never a number nobody received.
- **Status is never colour-alone.** Every belt-state dot ships a text label. Measured reason:
  the warn (`#e0a33a`) and bad (`#ff6b5e`) tokens separate by only ΔE 5.7 under deuteranopia.
- **Charts are single-hue and hand-rolled.** No chart library. The sequential ramp in
  `tokens.css` was solved numerically for monotone OKLab lightness, adjacent ΔL ≥ 0.06, and
  ≥ 2:1 contrast between the lightest data step and the card surface — in both themes.
- **The icon is the belt, not a walker.** It was drawn at 16px first, because that is the
  favicon and the tab strip, and only then checked at 512. Three filled shapes, no strokes,
  nothing narrower than 24px in a 512px box. The walker it replaced was eight strokes, a 30px
  head and a dashed centre line: at 16px the dashes vanished, the limbs merged and the deck
  outline filled in solid. Redraw the SVGs rather than the PNGs — the PNGs are exports:

  ```sh
  CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  "$CH" --headless --disable-gpu --default-background-color=00000000 \
    --screenshot=public/icon-512.png --window-size=512,512 "file://$PWD/public/icon.svg"
  ```

  Repeat at 192, and against `icon-maskable.svg` for `icon-maskable-512.png`. The maskable
  twin scales the glyph to 75% so Android's mask — the centre circle of 80% diameter — only
  ever cuts background.

  The three screenshots in the README are exports too, and a longer story: they need a
  month of walking history behind them and a belt actually moving in front of them.
  `tools/screenshots.sh` stages both — see [Screenshots](screenshots.md).

## Sessions

Sessions are detected from telemetry, not from the Start button, so a walk still records when
the belt is started from its own remote or handrail.

- Opens on the first frame with speed > 0; closes after 60 s of stillness, or on disconnect.
- Anything under 30 s is discarded as noise.
- **A pause holds the walk open for 15 minutes** instead of those 60 s, so a call or a coffee
  leaves one session rather than two — or, when the tail falls under the 30 s floor, rather
  than one and a discarded scrap. It banks no time: `activeMs` still only accrues while the
  belt is moving. The hold is released by resuming, by *End walk*, or by the 15-minute cap,
  which exists so a walk abandoned at lunch is filed as a lunchtime walk instead of absorbing
  whatever happens at four o'clock. Only the connection layer releases it on movement,
  because a belt coasting down from a pause and a belt somebody just set going again look
  identical from the session tick — the difference is whether it has come to rest since.
- Duration is **wall-clock time with the belt moving**, measured locally. It is
  protocol-independent and immune to the pad's counter resets.
- An in-flight session is checkpointed every 5 s, so reloading mid-walk resumes rather than
  splitting the walk in two.
- `Export CSV` on the History screen dumps everything, trust columns included.

History lives in `localStorage` and is never uploaded. Clearing site data clears it; export
first if you care about it.

## Export and import

Two exports, because they answer different questions.

- **`Export backup`** writes the complete record as JSON — every session, its speed samples,
  its trust map, and your settings, under a `walkingpad.backup.v1` schema tag. It is the only
  export that can be read back.
- **`Export CSV`** flattens one row per session for a spreadsheet. It drops the samples and
  nothing reads it back.

`Import backup` **merges**: a session id already present wins over the incoming copy, so
importing the same file twice is a no-op rather than a doubled history, and restoring onto a
browser that already has walks in it does not throw them away. The walk still in progress is
deliberately left out of an export — exporting a half-finished session would collide with
itself once it closes and carries its real totals.

Everything arriving from a file is untrusted: a backup can be hand-edited, truncated by a
full disk, or written by an older build, and whatever it contains lands in `localStorage` and
then in the charts. `src/state/backup.ts` therefore validates field by field and drops what it
cannot vouch for. An entry with no usable start time has nowhere to go on the calendar and is
skipped; a non-finite or negative number becomes zero rather than poisoning every total it
touches; an unrecognised protocol falls back to an all-`absent` trust map, which keeps its
numbers out of the aggregates. Under-trusting is the safe direction. A file that is not a
backup at all is refused outright, leaving the stored history untouched, and the count of
skipped rows is reported next to the button rather than swallowed.

## Feedback to support

There is no feedback endpoint, because there is no server: the app is static files, the
CSP allows `connect-src 'self'`, and the promise everywhere else in this document is that
a walk never leaves the browser. **Send feedback** keeps that literally true. It builds
the report in the page, shows it in the words that will be sent, and hands it to the
user's own mail client as a `mailto:` addressed to `support@beltcontrol.com`. Nothing is
transmitted by the page, so there is nothing to consent to and nothing to trust — the
person writing it is the one who presses send, and can edit or abandon it first.

It is reachable from two places, for two different reports. The footer sits under every
screen, so a complaint can be made from the screen it is about. The connection sheet has
its own entry beside the protocol log, which is the report the project actually asks for:
a pad speaking a protocol nobody has decoded.

The diagnostics block is opt-out, and it is a fixed list — build, browser UA, whether Web
Bluetooth exists at all, the driver that was selected, the device name, the belt state and
its speed range, and the *number* of stored sessions. A count, never a session. Without it
support spends two round trips asking which browser and which protocol; with it, the one
question a user cannot answer themselves ("Connect does nothing") is already answered. The
checkbox turns it off, and the preview above it is the real disclosure — a sentence
claiming what gets sent is a claim, the text itself is the thing.

What this costs is length. A `mailto:` is a URL, it goes through the OS shell, and the
shell stops carrying it somewhere around 2 KB — so a 400-line log does not fit, and cannot
be made to. `fitMailto` in `src/lib/feedback.ts` measures the *encoded* URL (every newline
triples on the way in), then drops log lines oldest-first until it fits, keeping the
newest — a failure is at the end of a log, and the connect handshake that scrolled off is
reconstructible from [the protocol reference](protocols.md) while the last four lines are
not. The typed message is the last thing given up, since it is the part support cannot
reconstruct at all. Every trim is stated twice: in the sheet, above the buttons, and in
the mail body itself. **Save report** writes the untrimmed thing to a file to attach, and
**Copy report** covers a browser with no mail client wired up at all. A log quietly cut in
half would be worse than no log, because the missing half is where the bug was.

## Counter resets

The pads report cumulative-since-power-on counters that reset without warning. Differencing
them naively produces negative deltas that silently corrupt every total, so a drop is treated
as a reset: the accumulator rebases on the new value and keeps going. See `Counter` in
`src/state/session.ts`, and the round-trip cases in `test/session.test.ts`.

## Field trust

Not every number a pad sends means what it appears to mean, and the app refuses to pretend
otherwise. Each session records a trust map, derived from its protocol:

| Protocol | distance | steps | calories |
|---|---|---|---|
| classic `fe00` | ok | ok | absent |
| FTMS `1826` | ok | **absent** | ok |
| KingSmith `0x1234` | **unverified** | ok | **unverified** |
| FitShow `fff0` | absent | absent | absent |

- `ok` — the device reports this in real units.
- `unverified` — the device sends a number whose scaling was never established (see
  [Driver 4](protocols.md#driver-4--kingsmith-0x1234-chip3)). Kept raw on the session, flagged
  with an amber marker in the UI, and **excluded from every aggregate**.
- `absent` — the protocol carries no such field at all. Shown as an em dash, never as `0`.

The exclusion rule is the point: a history screen that quietly sums unscaled numbers as if
they were kilometres is worse than no history at all. Where a screen drops values for this
reason, it says so in plain text rather than showing a quietly wrong total.
