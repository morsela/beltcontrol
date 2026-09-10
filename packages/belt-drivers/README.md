# @beltcontrol/belt-drivers

BLE drivers for KingSmith / WalkingPad treadmills, over Web Bluetooth.

Four protocols, one interface. Hand the package a `BluetoothRemoteGATTServer` and it works
out which of them the pad speaks, then gives you something you can start, stop and set the
speed of without ever asking which one it picked.

Not published. It is a workspace of
[beltcontrol](https://github.com/morsela/beltcontrol), which is its only consumer so far,
and it is documented here because a package with a contract needs its contract written
down somewhere other than the code that happens to use it.

## The shape of it

```ts
import { detectDriver, requestOptions } from '@beltcontrol/belt-drivers';

const device = await navigator.bluetooth.requestDevice(requestOptions());
const driver = await detectDriver(await device.gatt.connect());
if (!driver) throw new Error('nothing here speaks a protocol we know');

driver.onData = (patch) => console.log(patch);   // partial telemetry, merge it yourself
driver.onLog = (msg) => console.log(msg);        // every frame, both directions

await driver.attach(server);
await driver.start();
await driver.setSpeed(3.5);
```

`detectDriver` reads the GATT table once and matches it, falling back to probing each
service in turn on stacks that cannot enumerate. It returns `null` rather than guessing.

`requestOptions()` is there because Web Bluetooth blocks access to any service not declared
before the chooser opens, and which six services those are is this package's business, not
its caller's. It takes `{ name }` to offer one remembered pad, or `{ filtered: false }` to
offer everything — a pad whose advertised name is not in the catalog still works once it
is picked.

## What the protocols can do

| | speed | mode | steps | pause | pushes telemetry |
|---|---|---|---|---|---|
| `classic` — WalkingPad `0xfe00` | yes | yes | yes | no | no, poll it |
| `ftms` — Fitness Machine Service `0x1826` | yes | no | no | yes | yes |
| `ks1234` — KingSmith `0x1234` (chip:3) | yes | no | yes | yes | yes |
| `fitshow` — `0xfff0` | no | no | no | no | detect and log only |

Read it off `driver.capabilities` rather than off this table, and read the speed range off
`driver.minSpeedKmh` / `maxSpeedKmh` / `speedStep` **after** `attach()` — FTMS and `0x1234`
both rewrite those from what the unit says about itself, held to an envelope this package
will not exceed whatever the pad claims.

Frame-by-frame detail, and how each protocol was worked out, is in
[docs/protocols.md](../../docs/protocols.md).

## Three things worth knowing before you drive a belt with this

**A field the pad does not report is `null`, never `0`.** Nothing here invents a number, and
telemetry arrives as partial patches to merge onto what you already had — a frame carrying
only `RunningSteps` must not blank the distance.

**`pause()` answers `'paused'` or `'stopped'`.** FTMS has no way to advertise pause support,
so the only way to find out is to send it. A unit that cannot pause gets stopped instead,
and says so, because the alternative is a treadmill still running behind a button labelled
Paused.

**`startVerdict()` is about the command, not the belt.** It exists because a KS-C2 refuses a
start out loud, and a refusal heard in one second beats a silence timed out in ten. It is
absent on every protocol that cannot answer; read a missing method as `'unknown'` and wait
for the belt to report movement, which is the only thing that ever proves it.

## The other two entry points

```ts
import { simulatedDriver } from '@beltcontrol/belt-drivers/simulator';
import { FakeServer, FakeCharacteristic } from '@beltcontrol/belt-drivers/testing';
```

`/simulator` is a fifth driver with no hardware behind it — the same interface, a belt that
ramps, and switches for the two failures worth rehearsing: `{ refuseStarts: 2 }` plays back
a pad that says no twice, `{ rejectPause: true }` one whose pause is not real. It is kept
out of the main entry point so a dynamic import can split it out of your bundle.

`/testing` is a fake of the slice of Web Bluetooth the drivers touch, including a pad that
answers writes — enough to test the FTMS acknowledgement cycle and the `0x1234` handshake
with no treadmill in reach. Exported rather than kept private so consumers can test their
own connect path against the same fake.

## Layout

No build step: `exports` points at the TypeScript source and the consumer compiles it.

```
src/drivers.ts        all four drivers, the contract, the codecs, detection
src/bluetooth.ts      requestDevice options — service and name lists
src/simulator.ts      the fake pad
src/testing/          the fake GATT surface
test/                 the protocol suites — 140 tests, and the only
                      stand-in for hardware this project has
```

```sh
npm run check -w packages/belt-drivers   # tsc --noEmit, browser types only
npm test -w packages/belt-drivers        # ~50s: the 0x1234 driver sleeps between fragments
```

## Licence

[Apache-2.0](../../LICENSE), with the project's [NOTICE](../../NOTICE). Not affiliated with
Beijing KingSmith Technology Co., Ltd. — see
[docs/trademarks.md](../../docs/trademarks.md).
