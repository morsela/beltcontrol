# Screenshots

```sh
npm i -g agent-browser && agent-browser install   # once
tools/screenshots.sh                              # capture
tools/screenshots.sh --check                      # are they older than the UI?
```

The three images at the top of the README are generated, not staged. Regenerate them
whenever a change to `src/routes`, `src/components`, `src/charts` or `src/styles` alters
something a reader would notice, and commit the PNGs with the change that moved them.

## Why they are generated

They used not to be. The originals were captured by hand against a real browser window,
and carried a mouse cursor in the top-right corner of all three to prove it. Nothing in
the repo could rebuild them, so the only way to keep them honest was to remember how
they had been staged — which meant that in practice they would drift, and a README that
shows a UI two releases old is worse than one that shows none.

The obstacle was never the shutter. It is that these screens are only interesting with a
month of walking behind them and a belt actually moving in front of them, and neither is
something a browser has lying around. `tools/screenshots.sh` stages both.

## What it needs

[agent-browser](https://agent-browser.dev) drives Chrome over the DevTools protocol.
It is **deliberately not a dependency of this project**: it ships a browser of its own,
and three PNGs need it about twice a year. `npm install` here is six devDependencies and
stays that way. The script takes it from `PATH`, falls back to `npx -y agent-browser`,
and says which of the two is missing if neither works.

The script starts its own dev server on the first free port from 8123 and stops it on
the way out. It does not reuse one that is already running, and the reason is worth
recording: the first working run of this script photographed a *different checkout of
this app*, because a dev server from another branch's worktree was holding port 8080.
The only reason anyone noticed was that the branch in question was the one that moved
distance to miles, so the numbers came out in the wrong unit. Had it been any other
change the images would have been wrong and plausible. A screenshot tool that will
photograph whatever answers the door is worse than no screenshot tool.

## The fixture

`tools/screenshots/seed.js` runs as a page init script, before any app code, and writes
straight into the `localStorage` keys the app reads back on boot. It duplicates the
`Session` and `Settings` shapes from `src/state/` on purpose: a fixture that imports the
code it is posing for cannot pose for a version of that code which has since changed.
**When a `Session` field changes, this file has to be updated by hand** — the symptom is
a screen that renders empty, because `sanitizeSession` drops what it does not recognise.

It is twenty-nine days of history, plus two walks today:

| | |
|---|---|
| 29 prior days | 1315 minutes over 20 active days, at a fixed 3.73 km/h |
| this morning | 26m · 1.43 km · 1,930 steps, 08:12–08:38 |
| in progress | 5m03s · 0.42 km · 561 steps, on the simulated classic pad |

The fixture is metric, because everything the app stores is metric and only the display
is not — the same split the README describes for speed. So the distances above are the
stored values, and the screens render them in miles.

Every number the screens show falls out of that, which is why they are the numbers they
are — change one and the rest move with it:

- **31m walked today** — 26m + 5m03s, and **52% of goal** is `round(31.05/60 × 100)`.
- **1.15 mi · 2,491 steps** — the two walks today, added (1.85 km).
- **22h 26m · 51.9 mi · 21 active days** — the 29 days plus today (83.6 km).
- **3.0 mph** — `targetKmh: 4.8`, which is 3.0 mph to one decimal and keeps the `brisk`
  preset showing as the pressed one. `setTarget` rounds to the wire's 0.1 km/h anyway.
- The **145-minute day** sets the height of the column chart, and so where the dashed
  60-minute goal line falls across it. Eleven days at or over the goal are filled bars.
- The nine empty days are six at the front, where the app is not installed yet — that is
  the blank left edge of the chart — and three days off since.

The protocol is `classic`, because that is the trust map (`src/state/telemetry.ts`) under
which distance and steps are allowed into a total at all. Under a protocol the app does
not recognise, every walk here would be excluded from every figure and all three screens
would read empty.

## The thirty-second window

The hero floors its minutes and the goal meter rounds them, so "31m" and "31 of 60 min"
agree only while today's total is between 31.0 and 31.5 minutes. That is thirty seconds,
and no pair of numbers makes it wider. The belt is meanwhile still running, because a
still belt is not what the Now screen is for.

So the script re-anchors the walk in progress immediately before each shutter: it writes
a fresh open session and calls `restoreOpenSession()`, which is exactly what the app
already does on every connect. `currentSession`, the distance and step counters and the
sample array all come back consistent, and the numbers start drifting again from a known
point half a minute before they would round differently. It also flattens the ramp spike
that the live session ticker would otherwise leave on the right-hand edge of Today's
speed chart.

Every `wait` in the script is an assertion as much as a wait — it waits for the exact
string the screen should be showing. A UI change that moves one of them fails the script
at that line instead of quietly writing a wrong image.

## What is pinned, and what is not

Pinned: the dark scheme, reduced motion (plus a stylesheet that kills every transition,
because the goal meter animates its width on mount), `en-US` inside the page, `TZ` in the
environment, and 606×823 at 1×. That size is below the 64rem breakpoint in
`src/lib/viewport.ts`, which is what makes Now a screen at all rather than the left-hand
rail — on a desktop width `app.tsx` redirects `#/now` to `#/today`.

Not pinned, and not worth pinning:

- the **clock time** on Today's in-progress row follows the hour you capture at;
- the **`Jun 26` / `Jul 25`** axis labels on History follow the day you capture on;
- the **consistency heatmap shifts one column per day**, because `Heatmap.tsx` pads the
  front of the grid by the weekday of the window's first day.

Two runs an hour apart are otherwise near-identical — `now.png` came back byte-for-byte
identical, `history.png` differed by seventeen bytes. Two runs on different days never
will, which is the argument against pixel-diffing them in any automated check: a byte
comparison could only ever say "different".

One thing to avoid: **do not regenerate on the weekend the clocks change.** `dailySeries`
steps back in fixed 86,400,000 ms increments while `dayKey` is local-midnight based, so
on a DST boundary one calendar day is folded into two buckets and another is skipped.

## `--check`

`tools/screenshots.sh --check` compares the commit date of `docs/images` against the
newest commit touching the UI directories. Exit `0` current, `1` stale, `2` cannot
answer — three codes, because "the images are out of date" and "this check is broken"
are not the same news.

It is a trip-wire, not a proof, and it errs towards firing:

- Directory granularity is coarse. A change to `AmbientView.tsx`, which appears in none
  of the three images, fires it. The cost is a two-minute regeneration.
- It uses the committer date, so a rebase or an amend makes everything look newer than
  the images. `%at` would survive a rebase and break the other way, and of the two false
  positives this is the one that costs less than a README that lies.
- `git log` cannot see the working tree, so uncommitted UI changes are invisible to it.
  It prints them as a note rather than failing on them.
- `src/lib/format.ts` and `index.html` are not watched, though both can change what is
  on screen. Watching all of `src/` would fire on every driver change, and a check that
  fires constantly is one people learn to ignore. This page is the real backstop.
