# Testing

```sh
npm test                # vitest, one pass
npm run test:watch
npm run check           # tsc --noEmit over src and test
```

The suite is unit-level and needs neither a treadmill nor a browser. It runs in jsdom because
`src/state/session.ts` touches `localStorage` and `window.setInterval` at import time, and the
drivers decode `DataView`s the way the browser hands them over.

## What is covered

The tests concentrate on the places where a silent wrong answer would be worse than a crash —
protocol decoding and the arithmetic behind the totals.

| File | What it pins down |
|---|---|
| `test/drivers.classic.test.ts` | `fe00` command framing and checksum, status decoding, 3-byte counters past 16 bits, junk frames ignored |
| `test/drivers.ftms.test.ts` | the `0x2ACD` flags walk, the inverted "More Data" bit, the `0xFFFF` energy sentinel, signed incline, control-point acks *and* rejections |
| `test/drivers.ks1234.test.ts` | the permuted base64 codec, `props` parsing, 20-byte fragment reassembly in both directions, the connect handshake |
| `test/session.test.ts` | counter-reset rebasing, per-protocol trust exclusions, day aggregates, streaks, CSV export |
| `test/backup.test.ts` | the JSON backup round trip, import merging and idempotence, and what a hand-edited or foreign file is allowed to do to the stored history |
| `test/download.test.ts` | export filenames stamped with the local day, not the UTC one |
| `test/feedback.test.ts` | what a support report contains, and how it degrades into a `mailto:` too small to hold it — measured on the encoded URL, newest log lines kept, typed message surrendered last |
| `test/telemetry.test.ts` | merge-never-replace ingest, movement detection, the trust table |
| `test/format.test.ts` | duration and unit formatting, local-midnight day keys, a DST boundary |
| `test/metrics.test.ts` | which metrics each protocol may honestly display, and hero cycling |
| `test/platform.test.ts` | mobile detection, including iPadOS Safari's desktop UA |

## The BLE mock

`test/ble-mock.ts` is a small fake of the GATT surface the drivers touch: services,
characteristics, notifications, and a pad that can answer a write. That last part is what
makes it more than a stub — the FTMS driver blocks on a control-point indication, so the fake
pad acks writes and the whole request/response cycle can be tested:

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
- **The real BLE round trip.** No amount of mocking can vouch for it. `test/drivers.*.test.ts`
  encodes what the captures showed, not what a pad in the room does. If a driver is wrong
  about the hardware, these tests will agree with it.
- **The `0x1234` distance and calorie scaling**, which was never established — see
  [Field trust](design.md#field-trust). The tests assert those values pass through raw,
  which is the honest behaviour, not that they are correct.

The `0x1234` driver tests take ~10 s of the run: the driver sleeps between fragments to match
the pad's tolerance, and the handshake is nine messages. That delay is real protocol
behaviour, so it is left in rather than mocked away.
