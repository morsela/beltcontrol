import { describe, it, expect, beforeEach } from 'vitest';
import { classicDriver, CLASSIC_MODE, UUID } from '../src/lib/drivers.js';
import type { Telemetry } from '../src/lib/drivers.js';
import { FakeServer, FakeCharacteristic } from './ble-mock.js';

// F7 A2 <cmd> <param> <crc> FD, crc = (0xA2 + cmd + param) & 0xFF.
const frame = (cmd: number, param: number) =>
  [0xf7, 0xa2, cmd, param, (0xa2 + cmd + param) & 0xff, 0xfd]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');

/** 18-byte F8 A2 status frame: state, speed, mode, secs:3, dist:3, steps:3. */
function status({
  state = 2,
  speedKmh = 3.2,
  mode = CLASSIC_MODE.manual,
  secs = 0,
  distKm = 0,
  steps = 0,
} = {}) {
  const be3 = (v: number) => [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
  return [
    0xf8,
    0xa2,
    state,
    Math.round(speedKmh * 10),
    mode,
    ...be3(secs),
    ...be3(Math.round(distKm * 100)),
    ...be3(steps),
    0, 0, 0, 0, // trailing bytes the pad sends and the driver ignores
  ];
}

let notify: FakeCharacteristic;
let write: FakeCharacteristic;
let server: FakeServer;

beforeEach(() => {
  notify = new FakeCharacteristic(UUID.classicNotify);
  write = new FakeCharacteristic(UUID.classicWrite);
  server = new FakeServer().addService(UUID.classicService, [notify, write]);
});

describe('attach', () => {
  it('subscribes and wakes the app-control path with a poll', async () => {
    const d = classicDriver();
    await d.attach(server as unknown as BluetoothRemoteGATTServer);
    expect(notify.notifying).toBe(true);
    // The pad does not push status on its own; the first poll is what starts it talking.
    expect(write.hexWrites()).toEqual([frame(0, 0)]);
  });

  it('unsubscribes on detach, so a reconnect does not double-fire', async () => {
    const d = classicDriver();
    await d.attach(server as unknown as BluetoothRemoteGATTServer);
    expect(notify.listenerCount).toBe(1);
    await d.detach();
    expect(notify.listenerCount).toBe(0);
    expect(notify.notifying).toBe(false);
  });
});

describe('command frames', () => {
  let d: ReturnType<typeof classicDriver>;

  beforeEach(async () => {
    d = classicDriver();
    await d.attach(server as unknown as BluetoothRemoteGATTServer);
    write.writes.length = 0; // drop the attach-time poll
  });

  it('sends speed in tenths of a km/h', async () => {
    await d.setSpeed(3.0);
    expect(write.hexWrites()).toEqual([frame(1, 30)]);
  });

  it('rounds rather than truncates a fractional setpoint', async () => {
    // 2.0 mph is 3.218688 km/h; truncation would send 32 and lose a tenth.
    await d.setSpeed(3.218688);
    expect(write.hexWrites()).toEqual([frame(1, 32)]);
  });

  it('switches to manual before starting the belt', async () => {
    await d.start();
    expect(write.hexWrites()).toEqual([frame(2, CLASSIC_MODE.manual), frame(4, 1)]);
  });

  it('stops by zeroing speed and dropping to standby', async () => {
    await d.stop();
    expect(write.hexWrites()).toEqual([frame(1, 0), frame(2, CLASSIC_MODE.standby)]);
  });

  it('carries a checksum over every command byte', async () => {
    await d.setSpeed(4.5);
    const [f] = write.writes;
    expect(f).toBeDefined();
    const bytes = [...f!];
    expect(bytes[0]).toBe(0xf7);
    expect(bytes[5]).toBe(0xfd);
    expect(bytes[4]).toBe((bytes[1]! + bytes[2]! + bytes[3]!) & 0xff);
  });
});

describe('status frames', () => {
  let d: ReturnType<typeof classicDriver>;
  let seen: Partial<Telemetry>[];

  beforeEach(async () => {
    d = classicDriver();
    seen = [];
    d.onData = (t) => seen.push(t);
    await d.attach(server as unknown as BluetoothRemoteGATTServer);
  });

  it('decodes speed, time, distance and steps', () => {
    notify.emit(status({ speedKmh: 3.2, secs: 1_234, distKm: 1.75, steps: 2_048 }));
    expect(seen).toHaveLength(1);
    const t = seen[0]!;
    expect(t.speedKmh).toBeCloseTo(3.2, 6);
    expect(t.secs).toBe(1_234);
    expect(t.distKm).toBeCloseTo(1.75, 6);
    expect(t.steps).toBe(2_048);
  });

  it('reports calories as null, never 0 — the protocol has no such field', () => {
    notify.emit(status());
    expect(seen[0]!.kcal).toBeNull();
  });

  it('labels the belt state and keeps the raw code beside it', () => {
    notify.emit(status({ state: 2 }));
    expect(seen[0]!.stateLabel).toBe('running');
    expect(seen[0]!.state).toBe(2);
  });

  it('does not invent a label for an unknown state code', () => {
    notify.emit(status({ state: 42 }));
    expect(seen[0]!.stateLabel).toBe('state 42');
  });

  it('handles three-byte counters past 16 bits', () => {
    // A long walk overflows 16 bits: 65k steps is about 45 km of desk walking.
    notify.emit(status({ steps: 100_000, secs: 90_000 }));
    expect(seen[0]!.steps).toBe(100_000);
    expect(seen[0]!.secs).toBe(90_000);
  });

  it('ignores frames that are not the pad answering', () => {
    notify.emit([0x01, 0x02, 0x03]); // wrong header
    notify.emit([0xf8]); // too short to hold anything
    notify.emit([0xf8, 0xa2, 0x02, 0x20]); // right header, truncated body
    expect(seen).toHaveLength(0);
  });

  it('logs the last-session record without mistaking it for live telemetry', () => {
    const logs: string[] = [];
    d.onLog = (m) => logs.push(m);
    const rec = status();
    rec[1] = 0xa7;
    notify.emit(rec);
    expect(seen).toHaveLength(0);
    expect(logs.some((l) => l.startsWith('last session:'))).toBe(true);
  });
});
