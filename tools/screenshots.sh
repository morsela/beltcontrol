#!/usr/bin/env bash
# Regenerates the three screenshots README.md embeds, against the built-in simulator and
# a fixed fixture, so they can be reproduced rather than re-staged. The originals were
# captured by hand, and carried a mouse cursor in the top-right corner to prove it.
#
#   tools/screenshots.sh            capture docs/images/{now,today,history}.png
#   tools/screenshots.sh --check    fail if docs/images is older than the UI it shows
#
# Needs agent-browser, which is deliberately not a dependency of this project — it ships
# a browser of its own, and three PNGs need it about twice a year:
#
#   npm i -g agent-browser && agent-browser install
#
# Why the numbers are the numbers, and what is expected to differ between two runs, is
# in docs/screenshots.md.
set -euo pipefail
cd "$(dirname "$0")/.."

SESSION=beltcontrol-shots
SEED="$PWD/tools/screenshots/seed.js"
OUT="$PWD/docs/images"
UI_DIRS=(src/routes src/components src/charts src/styles)

# Local formatting is a screenshot's most volatile input, and agent-browser has a flag
# for neither half of it. The timezone can only come from the process the browser is
# launched out of; the locale can only be pinned inside the page, which seed.js does.
# -0700 is where the images already in docs/images were taken.
export TZ="America/Los_Angeles"
export LANG="en_US.UTF-8"

# --- is docs/images older than the UI it shows? --------------------------------------

check_staleness() {
  git rev-parse --git-dir >/dev/null 2>&1 || {
    echo "not a git repository — --check has nothing to compare." >&2
    return 2
  }

  local ui img dirty
  ui=$(git log -1 --format=%ct -- "${UI_DIRS[@]}")
  img=$(git log -1 --format=%ct -- docs/images)
  : "${ui:=0}" "${img:=0}"

  if [ "$img" = 0 ]; then
    echo "docs/images has never been committed — nothing to compare against." >&2
    return 2
  fi

  # git log cannot see the working tree, so say so rather than pass in silence.
  dirty=$(git status --porcelain -- "${UI_DIRS[@]}")
  if [ -n "$dirty" ]; then
    echo "note: the UI has uncommitted changes, which this check cannot see —"
    printf '%s\n' "$dirty" | sed 's/^/  /'
    echo
  fi

  if [ "$ui" -le "$img" ]; then
    echo "docs/images is current: newer than ${UI_DIRS[*]}."
    return 0
  fi

  {
    echo "docs/images is older than the UI it shows."
    echo
    for d in "${UI_DIRS[@]}"; do
      git log -1 --date=format:'%Y-%m-%d %H:%M' --format="  %cd  $d — %s" -- "$d"
    done
    git log -1 --date=format:'%Y-%m-%d %H:%M' --format="  %cd  docs/images — %s" -- docs/images
    echo
    echo "Regenerate them with:  tools/screenshots.sh"
  } >&2
  return 1
}

if [ "${1:-}" = "--check" ]; then
  check_staleness
  exit $?
fi
if [ $# -gt 0 ]; then
  echo "usage: tools/screenshots.sh [--check]" >&2
  exit 2
fi

# --- the browser ---------------------------------------------------------------------

if command -v agent-browser >/dev/null 2>&1; then
  AB_BIN=(agent-browser)
elif command -v npx >/dev/null 2>&1; then
  AB_BIN=(npx -y agent-browser)
else
  cat >&2 <<'MSG'
agent-browser is not on PATH and npx is not available.

  npm i -g agent-browser     # the CLI
  agent-browser install      # its own Chrome, from Chrome for Testing

It is deliberately not a dependency of this project. It ships a browser, and
`npm install` here is six devDependencies and stays that way.
MSG
  exit 2
fi

if ! "${AB_BIN[@]}" --version >/dev/null 2>&1; then
  echo "agent-browser is resolvable but will not run. Try: agent-browser install" >&2
  exit 2
fi

# Every call is scoped to one session, so this never disturbs a browser somebody else
# left open, and the trap has exactly one thing to close.
ab() { "${AB_BIN[@]}" --session "$SESSION" "$@"; }

# --- the dev server -------------------------------------------------------------------

SERVER_PID=
VITE_LOG=$(mktemp -t beltcontrol-shots)

cleanup() {
  rc=$?
  ab close >/dev/null 2>&1 || true
  # The `if` form, not `[ … ] && kill`: under set -e a false test is a failed command,
  # and the trap would exit 1 over the top of the real exit code.
  if [ -n "$SERVER_PID" ]; then kill "$SERVER_PID" 2>/dev/null || true; fi
  exit $rc
}
trap cleanup EXIT

# Always our own server, on a port of our own, never whatever happens to be answering
# on 8080. This is not defensiveness for its own sake: the first run of this script
# photographed a *different checkout* of this app, because a dev server from another
# worktree was already holding the port, and the only reason anyone noticed was that
# the other branch renders distance in miles. A screenshot tool that will photograph
# whatever answers the door is worse than no screenshot tool.
port_free() { ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
PORT=
for p in $(seq 8123 8199); do
  if port_free "$p"; then PORT=$p; break; fi
done
[ -n "$PORT" ] || {
  echo "no free port between 8123 and 8199." >&2
  exit 1
}
ORIGIN="http://127.0.0.1:${PORT}"

echo "starting a dev server for $(basename "$PWD") on ${ORIGIN}…"
# vite directly rather than `npm run dev`: the pid in the trap has to be the server
# itself, not an npm wrapper that exits and leaves it holding the port. --strictPort so
# that a race for the port fails here rather than moving the server somewhere this
# script is not looking.
npx vite --host 127.0.0.1 --port "$PORT" --strictPort >"$VITE_LOG" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 60); do
  curl -sfo /dev/null "$ORIGIN/" && break
  sleep 0.5
done
curl -sfo /dev/null "$ORIGIN/" || {
  echo "the dev server never came up — see $VITE_LOG" >&2
  exit 1
}

# Close any daemon left over from an earlier run, so the TZ exported above reaches a
# freshly launched Chrome rather than one that inherited somebody else's.
ab close >/dev/null 2>&1 || true

# --- viewport and fixture, both before the app's first byte ---------------------------

# Launch on a blank page, so the viewport and the fixture are both in place before the
# app's first byte. Setting the viewport afterwards would flash the desktop layout, and
# app.tsx:53 rewrites #/now to #/today the moment it sees a desktop width. It is
# about:blank rather than a bare `open` because the bare form only launches when no
# daemon has ever run for this session, and fails against a closed one.
#
# Retried because it races: the close above tears a daemon's socket down, and a launch
# that arrives while that is still happening fails with "Failed to connect". It is
# intermittent, and one retry has always been enough.
launched=0
for attempt in 1 2 3; do
  out=$("${AB_BIN[@]}" --session "$SESSION" --color-scheme dark --init-script "$SEED" \
        open about:blank 2>&1 || true)
  # The CLI reports this failure on stdout and still exits 0, so the exit code cannot
  # be used to tell the two apart.
  if ! printf '%s' "$out" | grep -q 'Could not configure browser'; then
    launched=1
    break
  fi
  echo "  browser did not come up (attempt ${attempt}), retrying…"
  sleep 1
done
[ "$launched" = 1 ] || {
  echo "agent-browser would not launch. Try: agent-browser doctor --fix" >&2
  exit 1
}

# 606x823 is the size of the images already in docs/images, and it is under the 64rem
# breakpoint in src/lib/viewport.ts — which is what makes #/now a screen at all rather
# than the left-hand rail. Scale stays 1: a 2x capture would be sharper, and would also
# double the bytes and make every future regeneration a whole-file rewrite in history.
ab set viewport 606 823
ab set media dark reduced-motion

ab open "$ORIGIN/#/now"
ab wait --load networkidle

# __wp is assigned after two dynamic imports resolve (src/main.tsx:22), so it is not
# there on the first frame — and it is not there at all in a production build, which is
# much the likelier mistake.
ab wait --fn "!!window.__wp" || {
  echo "window.__wp never appeared. This needs a dev build — npm run dev, not npm run preview." >&2
  exit 1
}

# --- connect the fake pad and get it up to 3.0 mph ------------------------------------

# connectSimulated and doStart rather than the buttons: Start is behind a confirmation
# dialog, which is exactly right for a person about to move a motor and pointless for a
# script that is not standing on anything. This is the same hook the README documents
# for walking the UI without a treadmill in reach.
echo "connecting the simulator…"
ab eval "window.__wp.connectSimulated('classic')" >/dev/null
ab wait --fn "window.__wp.connected.value === true"
ab eval "window.__wp.doStart()" >/dev/null

# The simulator ramps 0.35 km/h per second, so 3.0 mph is about fourteen seconds out.
# Wait for the belt to say it got there rather than sleeping for a number somebody
# guessed. Every wait from here on is an assertion as much as a wait: if a UI change
# moves one of these strings the script fails at the point of failure, rather than
# quietly writing a wrong image.
echo "waiting for the belt to reach 3.0 mph…"
ab wait --fn "document.querySelector('.tile .v')?.textContent.trim() === '3.0'"
ab wait --fn "document.querySelector('.chip')?.innerText.replace(/\s+/g,' ').trim() === 'Running · Simulated classic'"

# --- re-anchoring the walk immediately before each shutter ----------------------------
#
# Two things drift while the belt runs. activeMs decides whether the hero says 31m and
# the meter says "31 of 60 min", and those two agree for exactly thirty seconds —
# fmtDuration floors, Math.round rounds, and no pair of numbers makes that window wider.
# And the session ticker appends a sample every ten seconds, the first of which lands
# mid-ramp and puts a spike down to nothing on the right-hand edge of Today's chart.
#
# Both are fixed by handing the app a fresh open session and asking it to recover one,
# which is what it already does on every connect (wireDriver -> restoreOpenSession):
# currentSession, the distance and step counters and the sample array all come back
# consistent, and the numbers start drifting again from a known point half a minute
# before they would round differently.
#
# Keep the ramp in step with tools/screenshots/seed.js, which builds the same array.
# Wrapped in an IIFE because every eval lands in the same global scope, and this one is
# called three times: a bare top-level `const` is a redeclaration on the second shot.
pin_session() {
  ab eval --stdin >/dev/null <<'JS'
(() => {
const OPEN_MS = 303_000;
const TARGET_KMH = 4.8;
const samples = [];
for (let t = 0; t <= OPEN_MS; t += 10_000) {
  samples.push({ t, kmh: Math.min(TARGET_KMH, Math.round((0.35 + (t / 1000) * 0.35) * 1000) / 1000) });
}
const open = JSON.parse(localStorage.getItem('wp.session.open.v1'));
Object.assign(open, {
  startedAt: Date.now() - OPEN_MS,   // so the chart's "5 min" and the row's "5m" agree
  activeMs: OPEN_MS,
  distKm: 0.42,
  steps: 561,
  samples,
});
localStorage.setItem('wp.session.open.v1', JSON.stringify(open));
window.__wp.restoreOpenSession();
})();
JS
}

# The pointer never enters the page — we only ever eval, wait and screenshot. That is
# what keeps the column chart's hover tooltip out of the History image, and what removes
# the cursor the hand-staged originals carried. Escape is never sent either:
# connection.ts:699 binds it to doStop.

mkdir -p "$OUT"

echo "capturing Now…"
ab wait --fn "document.querySelector('.hero .value')?.textContent.trim() === '31m'"
pin_session
ab screenshot "$OUT/now.png" >/dev/null

echo "capturing Today…"
# location.hash, not a fresh open: the init script re-seeds on every navigation, and a
# navigation here would throw away the walk in progress. app.tsx:28 scrolls to the top
# on hashchange, so there is no scrolling to undo either.
ab eval -b "$(printf %s "location.hash='#/today'" | base64)" >/dev/null
ab wait --fn "document.querySelector('.page-sub')?.textContent.trim() === '2 sessions · 52% of goal'"
pin_session
ab screenshot "$OUT/today.png" >/dev/null

echo "capturing History…"
ab eval -b "$(printf %s "location.hash='#/history'" | base64)" >/dev/null
ab wait --fn "document.querySelectorAll('.stat .v')[0]?.textContent.trim() === '22h 26m'"
ab wait --fn "document.querySelectorAll('.stat .v')[2]?.textContent.trim() === '21'"
pin_session
ab screenshot "$OUT/history.png" >/dev/null

echo
for f in now today history; do
  printf '  %-24s %s\n' "docs/images/$f.png" "$(file -b "$OUT/$f.png")"
done
echo
echo "Look at all three before committing. docs/screenshots.md says what is expected to"
echo "have changed between two runs and what is not."
