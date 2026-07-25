import { describe, it, expect, beforeEach } from 'vitest';
import { ftmsDriver, parseTreadmillData, UUID } from '../src/lib/drivers.js';
import type { Telemetry } from '../src/lib/drivers.js';
import { FakeServer, FakeCharacteristic, toHex } from './ble-mock.js';

const view = (bytes: number[]) => new DataView(Uint8Array.from(bytes).buffer);
const u16 = (v: number) => [v & 0xff, (v >> 8) & 0xff];
const u24 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff];

describe('parseTreadmillData', () => {
  it('reads instantaneous speed when "More Data" is CLEAR', () => {
    // Bit 0 set means the opposite of what its name suggests: speed is absent.
    const d = parseTreadmillData(view([...u16(0x0000), ...u16(320)]));
    expect(d.speedKmh).toBeCloseTo(3.2, 6);
  });

  it('omits speed entirely when bit 0 is set', () => {
    const d = parseTreadmillData(view([...u16(0x0001), ...u16(1234)]));
    expect(d.speedKmh).toBeUndefined();
  });

  it('walks the flags with a cursor, not fixed offsets', () => {
    // Distance (bit 2) + energy (bit 7) + elapsed time (bit 10), no speed.
    const flags = (1 << 1) | (1 << 2) | (1 << 7) | (1 << 10) | 1;
    const d = parseTreadmillData(
      view([
        ...u16(flags),
        ...u16(250), // average speed 2.50 km/h
        ...u24(1_500), // total distance 1.5 km
        ...u16(87), // kcal
        ...u16(300), // kcal/hour
        7, // kcal/min
        ...u16(1_800), // elapsed seconds
      ])
    );
    expect(d.distKm).toBeCloseTo(1.5, 6);
    expect(d.kcal).toBe(87);
    expect(d.secs).toBe(1_800);
  });

  it('honours the spec’s "not available" energy sentinel', () => {
    const flags = (1 << 7) | 1;
    const d = parseTreadmillData(view([...u16(flags), ...u16(0xffff), ...u16(0), 0]));
    expect(d.kcal).toBeNull();
  });

  it('reads a negative incline as signed', () => {
    const flags = (1 << 3) | 1;
    const d = parseTreadmillData(view([...u16(flags), ...u16(0xffec), ...u16(0)])); // -20 → -2.0 %
    expect(d.inclinePct).toBeCloseTo(-2.0, 6);
  });

  it('finds heart rate after variable-width fields ahead of it', () => {
    const flags = (1 << 5) | (1 << 8) | 1; // pace (u8) then heart rate (u8)
    const d = parseTreadmillData(view([...u16(flags), 12, 128]));
    expect(d.heartRate).toBe(128);
  });

  it('keeps the raw frame for the log', () => {
    const bytes = [...u16(0x0000), ...u16(100)];
    expect(parseTreadmillData(view(bytes)).raw).toBe(toHex(bytes));
  });
});

// --- driver ---------------------------------------------------------------

const ackControlPoint = (bytes: Uint8Array, ch: FakeCharacteristic) =>
  // 0x80 <requested op> <result>, result 0x01 = success.
  queueMicrotask(() => ch.emit([0x80, bytes[0]!, 0x01]));

function padServer(opts: { speedRange?: number[] } = {}) {
  const data = new FakeCharacteristic(UUID.ftmsTreadmillData);
  const cp = new FakeCharacteristic(UUID.ftmsControlPoint, { onWrite: ackControlPoint });
  const chars = [data, cp];
  if (opts.speedRange) {
    chars.push(new FakeCharacteristic(UUID.ftmsSpeedRange, { value: opts.speedRange }));
  }
  return { server: new FakeServer().addService(UUID.ftmsService, chars), data, cp };
}

describe('ftmsDriver', () => {
  let seen: Partial<Telemetry>[];

  beforeEach(() => {
    seen = [];
  });

  it('adopts the unit’s advertised speed range', async () => {
    // min 0.5, max 6.0, step 0.1 km/h, each a little-endian hundredths u16.
    const { server } = padServer({ speedRange: [...u16(50), ...u16(600), ...u16(10)] });
    const d = ftmsDriver();
    await d.attach(server as unknown as BluetoothRemoteGATTServer);
    expect(d.minSpeedKmh).toBeCloseTo(0.5, 6);
    expect(d.maxSpeedKmh).toBeCloseTo(6.0, 6);
    expect(d.speedStep).toBeCloseTo(0.1, 6);
  });

  it('falls back to defaults when 0x2AD4 is missing', async () => {
    const { server } = padServer();
    const d = ftmsDriver();
    await d.attach(server as unknown as BluetoothRemoteGATTServer);
    expect(d.maxSpeedKmh).toBe(6);
  });

  it('takes control before doing anything else', async () => {
    const { server, cp } = padServer();
    const d = ftmsDriver();
    await d.attach(server as unknown as BluetoothRemoteGATTServer);
    expect(cp.hexWrites()).toEqual(['00']); // request control
  });

  it('does not re-request control it already holds', async () => {
    const { server, cp } = padServer();
    const d = ftmsDriver();
    await d.attach(server as unknown as BluetoothRemoteGATTServer);
    await d.start();
    await d.setSpeed(3.2);
    expect(cp.hexWrites()).toEqual(['00', '07', '02 40 01']); // 0x0140 = 320 = 3.20 km/h
  });

  it('re-requests control after a stop, which most units revoke', async () => {
    const { server, cp } = padServer();
    const d = ftmsDriver();
    await d.attach(server as unknown as BluetoothRemoteGATTServer);
    await d.stop();
    await d.setSpeed(2);
    expect(cp.hexWrites()).toEqual(['00', '08 01', '00', '02 c8 00']);
  });

  // The bug this guards: a unit still holding the previous session refuses Start outright,
  // so the second start of a sitting failed where the first succeeded.
  it('resets and retakes control when a start is refused', async () => {
    let refuseStart = true;
    const cp = new FakeCharacteristic(UUID.ftmsControlPoint, {
      onWrite: (b, ch) => {
        const op = b[0]!;
        const refused = op === 0x07 && refuseStart;
        if (op === 0x01) refuseStart = false; // reset clears whatever was blocking it
        queueMicrotask(() => ch.emit([0x80, op, refused ? 0x04 : 0x01]));
      },
    });
    const server = new FakeServer().addService(UUID.ftmsService, [
      new FakeCharacteristic(UUID.ftmsTreadmillData),
      cp,
    ]);
    const d = ftmsDriver();
    await d.attach(server as unknown as BluetoothRemoteGATTServer);
    cp.writes.length = 0;

    await d.start();

    expect(cp.hexWrites()).toEqual(['07', '01', '00', '07']); // start, reset, take control, start
  });

  it('re-requests control after a stop the unit rejected', async () => {
    // A failed stop used to leave `haveControl` stale, so the next start skipped Request
    // Control and was silently refused.
    const cp = new FakeCharacteristic(UUID.ftmsControlPoint, {
      onWrite: (b, ch) => {
        const ok = b[0] !== 0x08;
        queueMicrotask(() => ch.emit([0x80, b[0]!, ok ? 0x01 : 0x04]));
      },
    });
    const server = new FakeServer().addService(UUID.ftmsService, [
      new FakeCharacteristic(UUID.ftmsTreadmillData),
      cp,
    ]);
    const d = ftmsDriver();
    await d.attach(server as unknown as BluetoothRemoteGATTServer);
    cp.writes.length = 0;

    await expect(d.stop()).rejects.toThrow(/operation failed/);
    await d.start();

    expect(cp.hexWrites()).toEqual(['08 01', '00', '07']);
  });

  it('surfaces a rejected command instead of failing silently', async () => {
    const cp = new FakeCharacteristic(UUID.ftmsControlPoint, {
      onWrite: (b, ch) => queueMicrotask(() => ch.emit([0x80, b[0]!, 0x05])), // control not permitted
    });
    const server = new FakeServer().addService(UUID.ftmsService, [
      new FakeCharacteristic(UUID.ftmsTreadmillData),
      cp,
    ]);
    const d = ftmsDriver();
    await expect(d.attach(server as unknown as BluetoothRemoteGATTServer)).rejects.toThrow(
      /control not permitted/
    );
  });

  it('reports steps as null — FTMS carries no step count', async () => {
    const { server, data } = padServer();
    const d = ftmsDriver();
    d.onData = (t) => seen.push(t);
    await d.attach(server as unknown as BluetoothRemoteGATTServer);
    data.emit([...u16(0x0000), ...u16(320)]);
    expect(seen[0]!.steps).toBeNull();
    expect(seen[0]!.speedKmh).toBeCloseTo(3.2, 6);
  });

  it('has no mode switch', async () => {
    const d = ftmsDriver();
    await expect(d.setMode(1)).rejects.toThrow(/no mode switch/);
  });
});
