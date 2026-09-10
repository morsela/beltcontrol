# Testing

```sh
npm test                # vitest, one pass, both workspaces
npm run test:watch      # the app's suite; the drivers' is `npm run test:watch -w packages/belt-drivers`
npm run check           # tsc --noEmit over both workspaces
npm run lint            # oxlint, one pass over the whole tree
```

All four run on every pull request, in that order — see `.github/workflows/test.yml`.

The suites are split the way the code is. `packages/belt-drivers/test/` holds the four
protocol suites and answers one question — do the drivers put the right bytes on the wire
and read the right numbers back off it. `apps/web/test/` holds everything above that seam.
Each workspace runs its own vitest, so either can be run alone; the drivers' suite is the
slow one, at around fifty seconds, because the `0x1234` driver sleeps between fragments
and its start-verdict window is a real timeout.

## The linter

`oxlint`, configured in `.oxlintrc.json`, and deliberately a narrow one: its `correctness`
category, plus `react-hooks/rules-of-hooks`. That last rule is the reason the linter is
here at all — a hook called after an early return is invisible to the typechecker and to
the tests, works right up until a hook is added above it, and had already happened once in
`app.tsx`.

What is turned *off* matters as much. `react/immutability` and `react/purity` are the React
Compiler's rules and this is Preact with no compiler: refs are mutated on purpose here, and
`Date.now()` during render is how Today knows what day it is. `react/react-in-jsx-scope`
predates the automatic runtime. `react-hooks/exhaustive-deps` cannot see signals, so it
reads `connected.value` in a dependency array as a mistake when it is the point.

oxlint rather than ESLint because it is a single binary with no plugin tree behind it,
which keeps `npm ci` close to the handful of packages this project has always installed.

The suite is unit-level and needs neither a treadmill nor a browser. It runs in jsdom because
`apps/web/src/state/session.ts` touches `localStorage` and `window.setInterval` at import
time, and the drivers decode `DataView`s the way the browser hands them over. Both vitest
configs say so separately, because both suites need it.

## What is covered

The tests concentrate on the places where a silent wrong answer would be worse than a crash —
protocol decoding and the arithmetic behind the totals.

| File | What it pins down |
|---|---|
| `packages/belt-drivers/test/drivers.classic.test.ts` | `fe00` command framing and checksum, status decoding, 3-byte counters past 16 bits, junk frames ignored |
| `packages/belt-drivers/test/drivers.ftms.test.ts` | the `0x2ACD` flags walk, the inverted "More Data" bit, the `0xFFFF` energy sentinel, signed incline, control-point acks *and* rejections |
| `packages/belt-drivers/test/drivers.ks1234.test.ts` | the permuted base64 codec, `props` parsing, 20-byte fragment reassembly in both directions, the connect handshake |
| `apps/web/test/session.test.ts` | counter-reset rebasing, per-protocol trust exclusions, day aggregates, streaks, CSV export |
| `apps/web/test/backup.test.ts` | the JSON backup round trip, import merging and idempotence, and what a hand-edited or foreign file is allowed to do to the stored history |
| `apps/web/test/download.test.ts` | export filenames stamped with the local day, not the UTC one |
| `apps/web/test/feedback.test.ts` | what a support report contains, and how it degrades into a `mailto:` too small to hold it — measured on the encoded URL, newest log lines kept, typed message surrendered last |
| `apps/web/test/telemetry.test.ts` | merge-never-replace ingest, movement detection, the trust table |
| `apps/web/test/format.test.ts` | duration and unit formatting, local-midnight day keys, a DST boundary |
| `apps/web/test/metrics.test.ts` | which metrics each protocol may honestly display, and hero cycling |
| `apps/web/test/platform.test.ts` | mobile detection, including iPadOS Safari's desktop UA |

## The BLE mock

`packages/belt-drivers/src/testing/ble-mock.ts` is a small fake of the GATT surface the
drivers touch: services, characteristics, notifications, and a pad that can answer a write.
It lives in `src/` rather than beside the tests because it is an entry point the package
exports — `@beltcontrol/belt-drivers/testing` — so the app's connect test drives the real
connect path against the same fake pad the protocol suites use, instead of a second copy
of it drifting quietly out of step.

The pad answering a write is what makes it more than a stub: the FTMS driver blocks on a
control-point indication, so the fake pad acks and the whole request/response cycle can be
tested:

```js
const cp = new FakeCharacteristic(UUID.ftmsControlPoint, {
  onWrite: (bytes, ch) => queueMicrotask(() => ch.emit([0x80, bytes[0], 0x01])),
});
```

Without it, only the pure helpers (`parseTreadmillData`, `ksDecode`, `parseProps`) would be
reachable, and the attach/handshake/ack paths — where the real bugs live — would not be.

## What is deliberately not covered

- **The Preact components.** They are thin over the state modules; testing them would mostly
  test the renderer.
- **The real BLE round trip.** No amount of mocking can vouch for it. `packages/belt-drivers/test/drivers.*.test.ts`
  encodes what the captures showed, not what a pad in the room does. If a driver is wrong
  about the hardware, these tests will agree with it.
- **The `0x1234` distance and calorie scaling.** Both are now divided by 1000, established
  from a capture where the counters moved (see
  [Driver 4](protocols.md#driver-4--kingsmith-0x1234-chip3)). The tests assert the driver
  applies that scale; they cannot vouch for the derivation, which rests on the pad's own
  reported speed as ground truth. An odometer disagreeing with the app would settle it.

The `0x1234` driver tests take ~10 s of the run: the driver sleeps between fragments to match
the pad's tolerance, and the handshake is nine messages. That delay is real protocol
behaviour, so it is left in rather than mocked away.
