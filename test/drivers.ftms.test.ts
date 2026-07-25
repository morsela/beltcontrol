import { describe, it, expect, beforeEach } from 'vitest';
import { ftmsDriver, parseTreadmillData, UUID } from '../src/lib/drivers.js';
import type { Telemetry } from '../src/lib/drivers.js';
import { FakeServer, FakeCharacteristic, toHex } from './ble-mock.js';

const view = (bytes: number[]) => new DataView(Uint8Array.from(bytes).buffer);
const u16 = (v: number) => [v & 0xff, (v >> 8) & 0xff];
const u24 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff];
const FTMS_STOP = 0x08;

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

  it('does not read past a frame whose flags promise more than it carries', () => {
    // Every optional field claimed present, four bytes of payload. This threw a
    // RangeError out of the notification handler before, freezing the live readout.
    const flags = 0x1ffe;
    let d!: ReturnType<typeof parseTreadmillData>;
    expect(() => {
      d = parseTreadmillData(view([...u16(flags), 0x11, 0x22]));
    }).not.toThrow();
    expect(d.truncated).toBe(true);
  });

  it('keeps the fields that were fully present before the frame ran out', () => {
    // Speed present (bit 0 clear) and distance claimed (bit 2), but distance is a u24
    // and only two of its three bytes arrived.
    const d = parseTreadmillData(view([...u16(1 << 2), ...u16(320), 0x11, 0x22]));
    expect(d.speedKmh).toBeCloseTo(3.2, 6);
    expect(d.distKm).toBeUndefined();
    expect(d.truncated).toBe(true);
  });

  it('treats a frame too short to hold even the flags word as truncated', () => {
    const d = parseTreadmillData(view([0x00]));
    expect(d.truncated).toBe(true);
    expect(d.speedKmh).toBeUndefined();
  });

  it('does not mark a complete frame as truncated', () => {
    const d = parseTreadmillData(view([...u16(0x0000), ...u16(320)]));
    expect(d.truncated).toBeUndefined();
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

  it('refuses a speed range outside the app’s own envelope', async () => {
    // A stuck 0xFFFF in 0x2AD4 reads as 655.35 km/h. Adopting it would hand the
    // device sole authority over how fast the belt may be driven.
    const { server } = padServer({ speedRange: [...u16(50), ...u16(0xffff), ...u16(0xffff)] });
    const d = ftmsDriver();
    const logs: string[] = [];
    d.onLog = (m) => logs.push(m);
    await d.attach(server as unknown as BluetoothRemoteGATTServer);
    expect(d.maxSpeedKmh).toBe(6); // conservative default kept
    expect(d.speedStep).toBe(0.5); // ...as is the documented per-press ceiling
    expect(d.minSpeedKmh).toBeCloseTo(0.5, 6); // the one plausible field is still taken
    expect(logs.join('\n')).toMatch(/implausible max speed/);
  });

  it('refuses a step larger than the per-press ceiling the UI promises', async () => {
    const { server } = padServer({ speedRange: [...u16(50), ...u16(600), ...u16(300)] });
    const d = ftmsDriver();
    await d.attach(server as unknown as BluetoothRemoteGATTServer);
    expect(d.speedStep).toBe(0.5); // 3.0 km/h per press refused
  });

  it('never lets an adopted max fall below the min it is paired with', async () => {
    const { server } = padServer({ speedRange: [...u16(400), ...u16(100), ...u16(10)] });
    const d = ftmsDriver();
    await d.attach(server as unknown as BluetoothRemoteGATTServer);
    expect(d.minSpeedKmh).toBeCloseTo(4.0, 6);
    expect(d.maxSpeedKmh).toBe(6); // 1.0 km/h max under a 4.0 min describes no range
  });

  it('falls back to defaults when 0x2AD4 is missing', async () => {
    const { server } = padServer();
    const d = ftmsDriver();
    await d.attach(server as unknown as BluetoothRemoteGATTServer);
    expect(d.maxSpeedKmh).toBe(6);
  });

  it('keeps reporting telemetry after a truncated frame, and says so', async () => {
    const { server, data } = padServer();
    const d = ftmsDriver();
    const logs: string[] = [];
    d.onLog = (m) => logs.push(m);
    d.onData = (t) => seen.push(t);
    await d.attach(server as unknown as BluetoothRemoteGATTServer);

    expect(() => data.emit([...u16(0x1ffe), 0x11, 0x22])).not.toThrow();
    expect(logs.join('\n')).toMatch(/truncated treadmill frame/);

    // The next good frame still lands — the listener is not wedged.
    data.emit([...u16(0x0000), ...u16(250)]);
    expect(seen[seen.length - 1]!.speedKmh).toBeCloseTo(2.5, 6);
  });

  it('ignores an ack that answers a different opcode', async () => {
    // The pad acks 0x02 (set target speed) while a stop (0x08) is in flight. Treating
    // that as the stop's ack would report a stop the pad never confirmed.
    const data = new FakeCharacteristic(UUID.ftmsTreadmillData);
    const cp = new FakeCharacteristic(UUID.ftmsControlPoint, {
      onWrite: (bytes, ch) =>
        queueMicrotask(() => ch.emit([0x80, bytes[0] === FTMS_STOP ? 0x02 : bytes[0]!, 0x01])),
    });
    const server = new FakeServer().addService(UUID.ftmsService, [data, cp]);
    const d = ftmsDriver();
    const logs: string[] = [];
    d.onLog = (m) => logs.push(m);
    await d.attach(server as unknown as BluetoothRemoteGATTServer); // 0x00 is acked correctly
    await expect(d.stop()).rejects.toThrow(/timeout/);
    expect(logs.join('\n')).toMatch(/does not answer the pending 0x08/);
  });

  it('ignores an unsolicited ack arriving with nothing in flight', async () => {
    const { server, cp } = padServer();
    const d = ftmsDriver();
    const logs: string[] = [];
    d.onLog = (m) => logs.push(m);
    await d.attach(server as unknown as BluetoothRemoteGATTServer);
    cp.emit([0x80, 0x08, 0x01]); // "stop succeeded", unprompted
    expect(logs.join('\n')).toMatch(/unsolicited cp ack 0x08 ignored/);
  });

  it('still accepts an ack that does answer the request', async () => {
    const { server } = padServer();
    const d = ftmsDriver();
    await d.attach(server as unknown as BluetoothRemoteGATTServer);
    await expect(d.stop()).resolves.toBeUndefined();
  });

  it('ignores a truncated indication instead of reading past it', async () => {
    const { server, cp } = padServer();
    const d = ftmsDriver();
    await d.attach(server as unknown as BluetoothRemoteGATTServer);
    expect(() => cp.emit([0x80, 0x08])).not.toThrow();
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

  // --- pause --------------------------------------------------------------

  it('pauses with the pause parameter, not the stop one', async () => {
    const { server, cp } = padServer();
    const d = ftmsDriver();
    await d.attach(server as unknown as BluetoothRemoteGATTServer);
    await expect(d.pause()).resolves.toBe('paused');
    expect(cp.hexWrites()).toEqual(['00', '08 02']);
  });

  it('resumes with the same op code that starts the belt', async () => {
    // 0x07 is "Start or Resume" — there is no separate resume command to get wrong.
    const { server, cp } = padServer();
    const d = ftmsDriver();
    await d.attach(server as unknown as BluetoothRemoteGATTServer);
    await d.pause();
    await d.start();
    expect(cp.hexWrites()).toEqual(['00', '08 02', '00', '07']);
  });

  it('stops the belt when the unit rejects pause, and says so', async () => {
    // The one thing this must never do is report a pause to a treadmill still running.
    const cp = new FakeCharacteristic(UUID.ftmsControlPoint, {
      onWrite: (b, ch) =>
        queueMicrotask(() => {
          const rejectPause = b[0] === 0x08 && b[1] === 0x02;
          ch.emit([0x80, b[0]!, rejectPause ? 0x02 : 0x01]); // 0x02 = op code not supported
        }),
    });
    const server = new FakeServer().addService(UUID.ftmsService, [
      new FakeCharacteristic(UUID.ftmsTreadmillData),
      cp,
    ]);
    const d = ftmsDriver();
    await d.attach(server as unknown as BluetoothRemoteGATTServer);

    // No second Request Control: refusing an op code does not revoke it, so the fallback
    // stop still holds the control it took for the pause.
    await expect(d.pause()).resolves.toBe('stopped');
    expect(cp.hexWrites()).toEqual(['00', '08 02', '08 01']);
  });

  it('rethrows a transient rejection rather than reading it as "no pause here"', async () => {
    // 0x04 operation failed is a bad moment, not a verdict on the unit — swallowing it
    // as unsupported would retire a working Pause button over one glitch.
    const cp = new FakeCharacteristic(UUID.ftmsControlPoint, {
      onWrite: (b, ch) =>
        queueMicrotask(() => ch.emit([0x80, b[0]!, b[0] === 0x08 ? 0x04 : 0x01])),
    });
    const server = new FakeServer().addService(UUID.ftmsService, [
      new FakeCharacteristic(UUID.ftmsTreadmillData),
      cp,
    ]);
    const d = ftmsDriver();
    await d.attach(server as unknown as BluetoothRemoteGATTServer);

    await expect(d.pause()).rejects.toThrow(/operation failed/);
  });

  it('takes control back before pausing, having given it up on the last stop', async () => {
    const { server, cp } = padServer();
    const d = ftmsDriver();
    await d.attach(server as unknown as BluetoothRemoteGATTServer);
    await d.stop();
    await d.pause();
    expect(cp.hexWrites()).toEqual(['00', '08 01', '00', '08 02']);
  });
});
