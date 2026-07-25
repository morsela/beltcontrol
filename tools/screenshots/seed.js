// The month of walking the README screenshots are taken against.
//
// Runs as an agent-browser --init-script, which means it executes in the page before
// any app script does, so everything it writes is already in localStorage by the time
// src/main.tsx reads it back on line 13. Nothing here is imported by the app and
// nothing here imports the app: this is a stand-in for a month of walking, and a
// stand-in that imports the code it is posing for cannot pose for a version of that
// code which has since changed. The shapes below are copied from src/state/session.ts
// and src/state/settings.ts deliberately, and docs/screenshots.md says what to do when
// they drift apart.
//
// It is idempotent, and it is unconditional — which is why tools/screenshots.sh moves
// between screens with location.hash rather than a second navigation. Navigating again
// would re-run this file and throw away the walk in progress it just set up.

(() => {
  const SESSIONS_KEY = 'wp.sessions.v1';
  const OPEN_KEY = 'wp.session.open.v1';
  const SETTINGS_KEY = 'wp.settings.v1';
  const NOTICE_KEY = 'wp.desktopNotice.dismissed.v1';

  // 3.0 mph is 4.828 km/h, which setTarget rounds to the wire's 0.1 km/h resolution
  // anyway. Storing the rounded value means the readout says 3.0 before the belt has
  // been touched, and keeps the 3.0 / brisk preset chip showing as the pressed one.
  const TARGET_KMH = 4.8;
  const PACE_KMH = 3.73; // the historical days' pace — chosen to land the 83.6 km total
  const STEPS_PER_KM = 1350; // the figure src/lib/simulator.ts walks to
  const OPEN_MS = 303_000; // 5m03s — see docs/screenshots.md on the thirty-second window

  // The classic fe00 protocol, which is what connectSimulated('classic') attaches and
  // what the caption under the README table refers to. Its trust map is the one that
  // lets distance and steps into the totals at all — see src/state/telemetry.ts. A
  // protocol the app does not recognise gets an all-absent map, and every one of these
  // walks would then be excluded from every total and the screens would read empty.
  const CLASSIC = {
    protocol: 'classic',
    protocolName: 'SIMULATED (classic)',
    deviceName: 'Simulated classic',
    trust: { distKm: 'ok', steps: 'ok', kcal: 'absent' },
  };

  // Minutes per day, oldest first: index 0 is 29 days ago, index 28 is yesterday.
  // Today is not in here — it is the two sessions further down. Twenty active days plus
  // today is the 21 the History screen reports. The nine zeroes are six at the front,
  // where the app has not been installed yet, and three days off since. It sums to
  // 1315, which with today's 31 gives the 22h 26m total. The 145 sets the height of the
  // column chart, and so where the 60-minute goal line falls across it.
  const MINUTES = [
    0, 0, 0, 0, 0, 0, 71, 78, 55, 63, 88, 44, 0, 61, 52,
    58, 52, 74, 76, 0, 42, 145, 58, 47, 53, 0, 68, 66, 64,
  ];

  // Calendar arithmetic rather than subtracting 86_400_000 a day at a time: a day is
  // not always 24 hours, and a walk that lands at 23:00 the evening before is filed
  // under the wrong dayKey.
  const dayAt = (daysAgo, h, m) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - daysAgo);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  };

  const round3 = (n) => Math.round(n * 1000) / 1000;

  const walk = (id, startedAt, minutes, distKm, steps) => ({
    id,
    startedAt,
    endedAt: startedAt + Math.round(minutes * 60_000),
    activeMs: Math.round(minutes * 60_000),
    distKm,
    steps,
    kcal: 0,
    ...CLASSIC,
    samples: [], // only the walk in progress draws a chart
  });

  // One sample every 10 s, which is SAMPLE_EVERY_MS in src/state/session.ts, over the
  // ramp the simulator actually walks: 0.35 km/h per second up to the setpoint. Kept in
  // step with the copy in tools/screenshots.sh, which rebuilds it at capture time.
  const rampSamples = (spanMs) => {
    const out = [];
    for (let t = 0; t <= spanMs; t += 10_000) {
      out.push({ t, kmh: Math.min(TARGET_KMH, round3(0.35 + (t / 1000) * 0.35)) });
    }
    return out;
  };

  const history = [];
  MINUTES.forEach((min, i) => {
    if (min <= 0) return;
    const daysAgo = 29 - i;
    const distKm = round3((min / 60) * PACE_KMH);
    // Start times spread across the morning rather than the same hour every day, fixed
    // by index so that two runs on the same afternoon write the same bytes.
    history.push(
      walk(
        `shot-${daysAgo}`,
        dayAt(daysAgo, 7 + ((i * 3) % 9), (i * 7) % 60),
        min,
        distKm,
        Math.round(distKm * STEPS_PER_KM)
      )
    );
  });

  // The two walks the Today screen lists. Literal rather than derived from the pace
  // above, because these are the numbers in the README's images: they are the fixture
  // itself and not an output of it. 08:12 is the hour the originals caught, pulled back
  // when the capture runs early enough in the day that it has not happened yet.
  const morningStart = Math.min(dayAt(0, 8, 12), Date.now() - 95 * 60_000);
  const morning = walk('shot-today-am', morningStart, 26, 1.43, 1930);

  const open = {
    id: 'shot-today-open',
    startedAt: Date.now() - OPEN_MS,
    endedAt: null,
    activeMs: OPEN_MS,
    distKm: 0.42,
    steps: 561,
    kcal: 0,
    ...CLASSIC,
    samples: rampSamples(OPEN_MS),
  };

  localStorage.setItem(
    SESSIONS_KEY,
    JSON.stringify([...history, morning].sort((a, b) => a.startedAt - b.startedAt))
  );
  localStorage.setItem(OPEN_KEY, JSON.stringify(open));
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      goalMinutes: 60,
      presetsMph: [1.2, 2.0, 3.0],
      heroMetric: 'time',
      targetKmh: TARGET_KMH,
    })
  );
  // Belt and braces: headless Chrome reports a desktop user agent, so the "best on
  // desktop" banner never renders anyway — but a banner across the top of all three
  // images is not a thing to leave to a user-agent string.
  localStorage.setItem(NOTICE_KEY, '1');

  // --- pinning what the machine would otherwise decide ----------------------------
  //
  // The app formats clocks, dates and thousands separators with the *browser's* locale
  // (toLocaleTimeString(undefined, …) in src/lib/format.ts), so the same fixture renders
  // "8:02 PM · 2,491" here and "20:02 · 2 491" on a machine set to de-DE. The timezone
  // is pinned by TZ in tools/screenshots.sh, which is the only place it can be, since
  // Chrome takes it from the environment it was launched out of. The locale cannot be
  // reached from outside the page at all, so it is pinned in here.
  const pinLocale = (proto, name) => {
    const raw = proto[name];
    proto[name] = function (locales, options) {
      return raw.call(this, locales ?? 'en-US', options);
    };
  };
  pinLocale(Date.prototype, 'toLocaleTimeString');
  pinLocale(Date.prototype, 'toLocaleDateString');
  pinLocale(Number.prototype, 'toLocaleString');

  // set media reduced-motion covers most of this (tokens.css:156), but the goal meter
  // animates its width over 0.4s on mount and a half-drawn bar is not a thing to leave
  // to a media-emulation flag either. !important beats the app's own rules whatever the
  // sheet order, so this does not care when Vite injects the stylesheet.
  addEventListener('DOMContentLoaded', () => {
    const s = document.createElement('style');
    s.textContent = '*,*::before,*::after{animation:none!important;transition:none!important}';
    document.head.append(s);
  });
})();
