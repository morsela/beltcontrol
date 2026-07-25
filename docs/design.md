# Interface and session design

Why the app looks and behaves the way it does. Read this before changing the UI or the
session logic — most of what looks arbitrary here is load-bearing.

- [The three screens](#the-three-screens)
- [Design decisions](#design-decisions)
- [Sessions](#sessions)
- [Counter resets](#counter-resets)
- [Field trust](#field-trust)

## The three screens

Three tiers, each on its own screen, reachable from the bottom tab bar:

| Screen | Question it answers |
|---|---|
| **Now** | What is the belt doing, and how do I change it? |
| **Today** | What have I done today, and in which sessions? |
| **History** | Am I actually keeping this up? |

Speeds are shown in **mph**. Everything on the wire stays metric — the protocols all speak
km/h — so miles are a display concern only, converted in `src/lib/format.ts`.

## Design decisions

- **The hero number cycles.** Tapping it moves between time, distance, steps and calories —
  *skipping whatever the connected protocol cannot report*. FTMS carries no step count and
  neither the classic nor the `0x1234` frame carries calories, so a fixed six-tile grid
  guaranteed permanent em dashes on every real device. Availability is resolved once, at
  connect time, from `capabilities` plus the trust map in `src/state/telemetry.ts`.
- **Three speed presets.** The steppers move 0.2 mph per press to stay inside the
  0.5 km/h safety limit, which makes 1.2 → 3.0 mph nine presses. Desk walkers live at two or
  three fixed speeds, so those get chips.
- **Stop is pinned.** While the belt moves, Stop is fixed above the tab bar and cannot be
  scrolled away. `Esc` still works everywhere.
- **Ambient mode.** Hold the hero number: full-screen giant readout holding a
  `navigator.wakeLock`, with Stop always visible. Wake Lock is supported in exactly the same
  browsers as Web Bluetooth, so it adds no new requirement. It is deliberately *not* a
  celebration screen — it sits in peripheral vision for hours, so its job is to be legible
  and then ignorable.
- **Status is never colour-alone.** Every belt-state dot ships a text label. Measured reason:
  the warn (`#e0a33a`) and bad (`#ff6b5e`) tokens separate by only ΔE 5.7 under deuteranopia.
- **Charts are single-hue and hand-rolled.** No chart library. The sequential ramp in
  `tokens.css` was solved numerically for monotone OKLab lightness, adjacent ΔL ≥ 0.06, and
  ≥ 2:1 contrast between the lightest data step and the card surface — in both themes.

## Sessions

Sessions are detected from telemetry, not from the Start button, so a walk still records when
the belt is started from its own remote or handrail.

- Opens on the first frame with speed > 0; closes after 60 s of stillness, or on disconnect.
- Anything under 30 s is discarded as noise.
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
