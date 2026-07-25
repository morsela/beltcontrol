# Protocol reference

How KingSmith / WalkingPad treadmills speak Bluetooth, and how that was worked out.

Reverse engineered from **KS+Fit 6.5.6** (`com.kingsmith.xiaojin`, APKPure XAPK), plus an iOS
HCI capture for the `0x1234` family. The result is `src/lib/drivers.js`, which is deliberately
plain JavaScript — it is the reverse-engineered half of the project, it has no DOM
dependencies, and rewriting it in TypeScript would risk the protocol work for no runtime gain.
`src/lib/drivers.d.ts` types it from the outside.

- [How the official app works](#how-the-official-app-works)
- [The protocol families](#the-protocol-families)
- [Driver 1 — Classic WalkingPad (`0000fe00`)](#driver-1--classic-walkingpad-0000fe00)
- [Driver 2 — FTMS (`00001826`)](#driver-2--ftms-00001826)
- [Driver 3 — FitShow (`0000fff0`)](#driver-3--fitshow-0000fff0)
- [Driver 4 — KingSmith `0x1234` (chip:3)](#driver-4--kingsmith-0x1234-chip3)
- [Reproducing the analysis](#reproducing-the-analysis)

## How the official app works

The app is **Flutter**. All Bluetooth logic is Dart AOT-compiled into
`lib/armeabi-v7a/libapp.so` (34 MB), in a first-party package `ks_blue`
(`ks_blue/src/{ble,wilink,fitshow,rower,dumbbell,...}`). The Java/Kotlin dex files contain no
BLE code — they are analytics, push, Huawei HMS, and media SDKs.

**Pairing is unauthenticated on the classic and FTMS paths.** There is no PIN, no bonding
requirement, no key exchange, no challenge/response, and no cloud token gate.
`WilinkDevice._internal` connects, subscribes to notifications (`_addAllNotifyAndRead`,
`_initNotifyEvent`), and writes commands.

The `chip:3` / `0x1234` path is different: a real KS-C2 **drops the link 1.8–3.6 s after
connecting** unless a handshake is written. It is still not authenticated — there is no
secret, and the handshake is a fixed sequence anyone can replay — but a passive client that
never writes cannot stay connected, which is why this protocol went undocumented for so long.
See [Driver 4](#driver-4--kingsmith-0x1234-chip3).

**Discovery is name-prefix filtering.** `DeviceScanManager` (`_loadFilterWords`,
`_buildFilterMappings`, `_filterUnwantedDevices`) matches advertised device names against
`leach_word` entries in `assets/flutter_assets/assets/mine/allProducts.json` — a catalog of 83
products. Each entry carries:

- `chip` (2/3/5/6) — selects the protocol
- `deviceType` — 0 treadmill, 1 walking pad, 2 spinning, 3 dumbbell, 4 rowing, 5 bench,
  7 crawler, 8 stair climber
- `speed` — the model's max speed in km/h
- `leach_word` — comma-separated BLE name prefixes

`_parseServiceUuidProtocol` / `_getDeviceTypeByProtocol` then confirm the choice from the
advertised service UUIDs. This app follows the same approach, but skips the catalog and
detects purely from the GATT table, which is more robust.

## The protocol families

| Family | Service | Notify | Write | Models | Status |
|---|---|---|---|---|---|
| Classic "WalkingPad" | `0000fe00` | `0000fe01` | `0000fe02` | `chip:2` — A1, A1 Pro, C1, C2, P1, R1 Pro, R2, K12, K15, T1, KS-F0/F1 | implemented |
| **FTMS** (Bluetooth SIG standard) | `00001826` | `2acd`, `2ada` | `2ad9` | `chip:5` — Z1, Z3, P1E, MT1, W1, X21, X26, G2, MX8, K50S, K20S, … | implemented |
| FitShow | `0000fff0` | `0000fff1` | `0000fff2` | some OEM units (`ks_blue/src/fitshow/`) | detect only |
| **KingSmith `0x1234`** | `00001234` | `0000fed8` | `0000fed7` | `chip:3` — **KS-C2**, G1, G1 Pro, MX16, X21, K12 Pro, KS-K9 | implemented |

Do not assume `chip` maps to protocol the way the first three rows suggest — `chip:3` was
initially missed here precisely because of that assumption. Detect from the GATT table.

None of these UUIDs appear on the W3C Web Bluetooth
[`gatt_blocklist.txt`](https://github.com/WebBluetoothCG/registries), so a web page is
permitted to use them.

### Driver 1 — Classic WalkingPad (`0000fe00`)

Command frame, written to `fe02`:

```
F7 A2 <cmd> <param> <crc> FD        crc = (0xA2 + cmd + param) & 0xFF
```

| Action | Frame |
|---|---|
| Ask stats | `F7 A2 00 00 A2 FD` |
| Set speed | `F7 A2 01 <0.1 km/h> <crc> FD` — param `0` stops the belt |
| Set mode | `F7 A2 02 <0 auto / 1 manual / 2 standby> <crc> FD` |
| Start belt | `F7 A2 04 01 A7 FD` |

Start is wake-mode-then-start: `askStats` → `setMode(manual)` → `start` → `setSpeed(n)`.
Stop is `setSpeed(0)` → `setMode(standby)`. Commands sent back-to-back get dropped, so the
driver spaces them ~120 ms apart, and it waits ~400 ms after the mode byte before starting the
belt.

The leading `askStats` is not decoration. Standby parks the same app-control path that
`attach()` has to wake before anything works, so a start sent straight after a stop arrives at
a pad that is not listening — which is why only the first start of a session used to land.

There is **no pause** in this command set, in the APK or in `ph4-walkingpad`. Speed 0 without
the standby that follows it in `stop()` is the obvious candidate, but whether the belt picks
up again from there has never been checked on a pad, so `pause()` throws.

Notifications arrive on `fe01`. Integers are **big-endian**.

Current status — header `F8 A2`, 18 bytes:

| Bytes | Field |
|---|---|
| `[2]` | belt state |
| `[3]` | speed ÷10 → km/h |
| `[4]` | mode |
| `[5..7]` | elapsed seconds |
| `[8..10]` | distance ÷100 → km |
| `[11..13]` | steps |
| `[14]` | app speed ÷30 |
| `[16]` | controller button |

Last-session record — header `F8 A7`: `[8..10]` time, `[11..13]` distance, `[14..16]` steps.

The pad does **not** push status on its own, so the app polls `askStats()` once per second.

Belt-state codes are not spelled out anywhere in the APK. `drivers.js` maps them to
best-effort labels and the UI shows the raw number alongside, so a wrong guess is visible
rather than silently misleading.

Frame layout cross-checked against [`ph4-walkingpad`](https://github.com/ph4r05/ph4-walkingpad)
(`ph4_walkingpad/pad.py`), whose UUIDs match those found in the APK exactly.

### Driver 2 — FTMS (`00001826`)

Standard Bluetooth SIG Fitness Machine Service, so this is spec-driven rather than reverse
engineered. Control Point `2ad9` (write + indicate), **little-endian**:

| Action | Bytes |
|---|---|
| Request Control — must be first | `00` |
| Reset | `01` |
| Set Target Speed | `02 <uint16 lo> <hi>` in 0.01 km/h |
| Start / Resume | `07` |
| Stop | `08 01` |
| Pause | `08 02` |

Acknowledgements arrive as indications `80 <reqOpCode> <result>`, where `result == 0x01` is
success. Every command is gated on its ack and failures surface in the UI — the app itself
ships a `ftms_control_fail_tips` string, so rejection is expected in practice. Most units drop
control permission on stop, so the driver re-requests it — including when the stop itself was
rejected, since a unit that refused to stop has certainly not handed control back. A unit that
never fully left the previous session then refuses `07` outright; the driver answers `04`
*operation failed* and `05` *control not permitted* with a `01` reset and one retry.

**Pause is real here, and only here.** One op code covers "Start or Resume" and one covers
"Stop or Pause", so resuming needs no command of its own — `07` does both jobs. Support
cannot be discovered in advance: there is no pause bit in `2acc` Feature or anywhere else, so
the spec's own answer is to send it and read the result. A unit that cannot pause replies
`02` op-code-not-supported or `03` invalid-parameter, and `pause()` then stops the belt and
reports `'stopped'` back to the caller, which drops the button for the rest of the
connection. A belt still running under a button that says Paused is the one outcome worth
writing code to prevent.

KS+Fit does the same thing — `2ad9: request pause or stop, result: ` sits in its `libapp.so`.

**Treadmill Data (`2acd`)** is a `uint16` flag field followed by only the present fields, in
spec order. Layout varies per device, so `parseTreadmillData()` walks the flags with a cursor
rather than using fixed offsets:

| Bit | Field(s) |
|---|---|
| 0 | *More Data* — instantaneous speed `uint16` 0.01 km/h is present when this bit is **clear** |
| 1 | average speed `uint16` 0.01 km/h |
| 2 | total distance `uint24` m |
| 3 | inclination `sint16` 0.1 %, ramp angle `sint16` 0.1° |
| 4 | elevation gain up/down `uint16` 0.1 m |
| 5, 6 | instantaneous / average pace `uint8` 0.1 km/min |
| 7 | total energy `uint16` kcal, per hour `uint16`, per minute `uint8` |
| 8 | heart rate `uint8` bpm |
| 9 | METs `uint8` 0.1 |
| 10 | elapsed time `uint16` s |
| 11 | remaining time `uint16` s |
| 12 | force on belt `sint16` N, power `sint16` W |

Also used: `2ada` Fitness Machine Status (state changes), `2acc` Feature (capabilities), and
`2ad4` Supported Speed Range (min/max/increment) to clamp the speed control to what the unit
actually accepts.

**FTMS carries no step count.** The dashboard shows `—` for steps on FTMS devices rather than
inventing a number.

### Driver 3 — FitShow (`0000fff0`)

Detected and observed only. The driver subscribes to `fff1` and logs raw frames; control is
not implemented because the framing has not been confirmed against a real unit. If your pad
lands here, share the log and it can be decoded properly.

### Driver 4 — KingSmith `0x1234` (chip:3)

Decoded from an iOS Bluetooth HCI capture of KS+Fit driving a real **KS-C2**. As far as I can
tell this protocol has not been published anywhere before.

```
transport : write -> fed7 (write-without-response),  notify <- fed8
framing   : ksBase64(plaintext) + "\r", fragmented across 20-byte ATT writes
payload   : plain text, space separated — "props CurrentSpeed 1.1"
```

**The encoding is base64 with a permuted alphabet**, a 64-char literal in `libapp.so`:

```
custom  SaCw4FGHIJqLhN+P9RVTU/WcY6ObDdefgEijklmnopQrsBuvMxXz1yA2t5078KZ3
std     ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/
```

Index 62 (`Z`) never appears in the captured traffic, so that one slot is inferred; every
other position is confirmed against real bytes. The literal in the binary has `Z` and `S`
transposed relative to this — solving the alphabet from known plaintext gives 100% printable
output only with them swapped, versus 96.6% as stored.

**Handshake.** The pad drops the link **1.8–3.6 s** after connecting unless this runs, which is
what makes the protocol undiscoverable by passive listening. Same order as the official app:

| → sent | ← reply |
|---|---|
| `shake` | `shake 00` |
| `time_posix <unix seconds>` | `time_posix 0` |
| `version` | `version 0014` |
| `servers getProp 1 3 7 8 9 16 17 18 19 21 22 23 24 13 15` | `servers 0`, then a full config dump |
| `props user_id <id>` | — |  <!-- any integer; the pad does not validate it -->
| `get_pk` | `get_pk 3` |

`user_id` is not an identity the protocol checks — the pad accepts any integer and the app
never reads it back. The value visible in the capture is the KS+Fit account id of the phone
being recorded, so this app sends a random per-install number kept in `localStorage`
instead: stable enough for a pad that keys its own bookkeeping off it, and connected to no
real account.
| `props ControlMode 1` | `props ControlMode 1` |
| `servers getProp 1 9 15 2 10 11 12 13 14` | `servers 0` — subscribes to live telemetry |

`ControlMode 1` hands control to the app; `2` is the pad's own panel.

**Control**

| Action | Message |
|---|---|
| Start | `props ControlMode 1` → `props runState 1` |
| Stop | `props runState 0` |
| Set speed | `props CurrentSpeed 1.1` (km/h, one decimal) |

Stopping hands control back to the pad's own panel, and in panel mode `runState 1` is accepted
and ignored — the belt simply does not move, with no error anywhere. `ControlMode 1` therefore
has to be re-asserted on every start, not just once during the handshake.

**Pause exists on this family but has not been captured.** KS+Fit's BLE layer for these
pads — the `Wilink*` classes, whose property names (`ControlMode`, `ChildLockSwitch`,
`VelocitySensitivity`, `runState`) are exactly the ones above — carries a pause alongside
start and stop, and the app has a paused device state to go with it:

```
WilinkDeviceActionExt|setStart    WilinkDeviceActionExt|setStop
WilinkDeviceActionExt|setPause    WilinkDeviceActionExt|startOrStop
KsTreadmillDevice startOrPause mode:
Speed adjustment is not supported when the device is paused.
```

The payload is not recoverable from the binary — the command templates are built at runtime,
which is the same reason the protocol needed a capture in the first place, and `blutter` is
still arm64-only against this v7a build. The capture itself only ever exercised `runState`
`0` and `1`. `props runState 2` is the obvious guess and it stays a guess: `ks1234Driver.pause()`
throws rather than aim an unverified control command at a treadmill. Settling it needs one
more HCI trace — start a walk in KS+Fit, press pause, press resume — through the same
pipeline as above.

**Telemetry** arrives on `fed8` as `props` lines, often **partial** — `props RunningSteps 3` on
its own is normal, so merge updates rather than replacing state:

`runState` (0 stopped, 1 running) · `CurrentSpeed` km/h · `RunningTotalTime` seconds ·
`RunningSteps` · `RunningDistance` · `BurnCalories`

The connect-time config dump also yields `Max` (6.0 on the C2 — matching the product catalog,
an independent confirmation the decode is correct), `StartSpeed`, `ChildLockSwitch`,
`VelocitySensitivity`, `PanelDisplay`, `unit`, `initial` and `mcu_version`.

Scaling for `RunningDistance` and `BurnCalories` is **not established** — both stayed at 0
through the short capture. `drivers.js` passes them through raw rather than guessing, and the
app marks them `unverified` so they never enter a total. See
[Field trust](design.md#field-trust).

Verification: `ksEncode()` reproduces the official app's ciphertext **byte-for-byte** for
`shake`, `get_pk`, `props runState 1`, `props runState 0`, `props CurrentSpeed 1.1` and
`props ControlMode 1`.

**GATT surface** — one service, two characteristics, nothing else (no Device Information, no
Battery):

```
service 00001234-0000-1000-8000-00805f9b34fb
  char 0000fed7-...  [read, writeWithoutResponse]   ← host writes commands here
       = 36 41 2f 31 63 32 61 72 0d   "6A/1c2ar\r"   (this is ksBase64 for "get_pk")
  char 0000fed8-...  [read, notify]                 ← device reports here
       = 00 00 00 00 00 00 00 00 00 00 00 00 00     (13 zero bytes before the handshake)
```

`fed8` notifies about once a second even before the handshake, but carries an empty status
until the pad is woken. Reading `fed7` returns `get_pk` in encoded form — a leftover, and the
red herring that cost the most time here.

**How this was captured.** iOS HCI trace: Apple's *Bluetooth for iOS/iPadOS* logging profile
(developer.apple.com/bug-reporting/profiles-and-logs) plus PacketLogger from Additional Tools
for Xcode. Then:

```sh
tshark -r capture.pklg -Y 'btatt.opcode==0x52 && btatt.handle==0x000d' \
       -T fields -e frame.time_relative -e btatt.value    # app -> pad
tshark -r capture.pklg -Y 'btatt.opcode==0x1b && btatt.handle==0x0012' \
       -T fields -e frame.time_relative -e btatt.value    # pad -> app
```
Reassemble across writes on `\r`, then decode with the permuted alphabet above.

<details>
<summary>Approaches that failed before the capture — don't repeat these</summary>

| Attempt | Result |
|---|---|
| `strings` for the command literals | not present; the app builds them at runtime |
| Scan for any printable run terminated by `\r` | 231 hits, all UTF-16 noise, no templates |
| Object-pool xrefs to the `fed7`/`fed8`/`1234` string objects | **zero** — structural, see below |
| `blutter` (the Dart AOT reversing tool) | **arm64 only**; this binary is `armeabi-v7a` |
| Obtaining an arm64 build | APKPure serves v7a only (site + `apkeep`); APKMirror doesn't carry the app; Huawei has no build; Google Play needs account credentials |
| Treating `fed7`'s read value as the last-written command | wrong reasoning, right answer — it is a constant, but it *is* an encoded command (`get_pk`) |
| Keeping the link alive with GATT reads | fails; the pad still drops at 1.8–3.6 s |
| Passive sniffing | cannot work — without the handshake the pad disconnects before sending anything |

The xref failure is structural, not a mistake in method. `libapp.so` has **no relocation
section** (`objdump -h` shows only `.rodata`, `.text`, `.dynamic`, `.bss` and friends), so the
snapshot stores references as cluster-relative indices resolved during deserialization at
startup — not as pointers. Recovering that graph needs a full Dart snapshot parser, which is
what `blutter` is.

The string objects themselves decode cleanly, which is how the alphabet was eventually found:
Dart 32-bit `OneByteString` is `[tags:4][hash:4][length:Smi 4][chars]`, and a scan for any
64-char run that is a permutation of the standard base64 alphabet located it directly.

</details>

## Reproducing the analysis

Nothing from KS+Fit is redistributed in this repository. To get the same inputs:

```sh
brew install jadx
unzip -q "KS+Fit_6.5.6_APKPure.xapk" -d xapk
unzip -q xapk/com.kingsmith.xiaojin.apk -d base            # dex, flutter_assets
unzip -q xapk/config.armeabi_v7a.apk -d v7a                # libapp.so

# UUIDs the Dart code actually references
strings -a v7a/lib/armeabi-v7a/libapp.so \
  | grep -oiE "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}" | sort -u

# Dart source paths and class/method names survive AOT compilation
strings -a v7a/lib/armeabi-v7a/libapp.so | grep -oE "package:ks_blue/[a-zA-Z0-9_/.]+\.dart" | sort -u

# the product → protocol catalog
python3 -m json.tool base/assets/flutter_assets/assets/mine/allProducts.json
```

---

The decoding above is exercised by `test/drivers.*.test.ts` — see [Testing](testing.md).
Legal position on the analysis: [Trademarks and independence](trademarks.md).
