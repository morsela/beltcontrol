import { describe, it, expect } from 'vitest';
import { hex, adoptSpeedLimits, detectDriver, HARD_MIN_KMH, UUID } from '../src/lib/drivers.js';
import { FakeServer, FakeCharacteristic } from './ble-mock.js';

describe('hex', () => {
  it('formats a whole buffer', () => {
    expect(hex(Uint8Array.from([0xf7, 0x00, 0x0a]).buffer)).toBe('f7 00 0a');
  });

  // Every driver logs frames it was handed as a DataView. Reading `.buffer` off one
  // ignores byteOffset/byteLength and only works because Chrome happens to hand out
  // zero-offset views; passing the view itself used to produce an empty string, so a
  // frame logged that way vanished silently rather than failing loudly.
  it('formats a view of part of a buffer, not the whole buffer behind it', () => {
    const buf = Uint8Array.from([0xde, 0xad, 0xaa, 0xbb]).buffer;
    expect(hex(new DataView(buf, 2))).toBe('aa bb');
    expect(hex(new Uint8Array(buf, 2))).toBe('aa bb');
  });

  it('never returns an empty string for a frame that has bytes in it', () => {
    expect(hex(new DataView(Uint8Array.from([1, 2]).buffer))).not.toBe('');
  });
});

describe('adoptSpeedLimits', () => {
  /** The conservative limits every driver starts from. */
  const pad = () => ({ minSpeedKmh: 1.0, maxSpeedKmh: 6, speedStep: 0.5 });

  it('takes limits inside the envelope', () => {
    const d = adoptSpeedLimits(pad(), { min: 1.5, max: 5, step: 0.2 });
    expect([d.minSpeedKmh, d.maxSpeedKmh, d.speedStep]).toEqual([1.5, 5, 0.2]);
  });

  it('raises a minimum below the floor rather than refusing it', () => {
    // A pad wanting to crawl slower than the app will drive is not talking nonsense,
    // and refusing it would keep a default the device just said is wrong for it.
    const logs: string[] = [];
    const d = adoptSpeedLimits(pad(), { min: 0.2 }, (m) => logs.push(m));
    expect(d.minSpeedKmh).toBe(HARD_MIN_KMH);
    expect(logs.join('\n')).toMatch(/below the .* floor/);
  });

  it('keeps the conservative default for a field outside the envelope', () => {
    const logs: string[] = [];
    const d = adoptSpeedLimits(pad(), { max: 99 }, (m) => logs.push(m));
    expect(d.maxSpeedKmh).toBe(6);
    expect(logs.join('\n')).toMatch(/implausible max speed/);
  });

  // The 0x1234 driver reports StartSpeed and Max in separate frames, so a minimum can
  // arrive on its own and land above a maximum that is still the default. That pair
  // describes no usable range: SpeedControl reads it as "at the minimum" and "at the
  // maximum" at once and disables both steppers.
  it('refuses a minimum that would sit above the maximum', () => {
    const logs: string[] = [];
    const d = adoptSpeedLimits(pad(), { min: 7 }, (m) => logs.push(m));
    expect(d.minSpeedKmh).toBe(1.0);
    expect(logs.join('\n')).toMatch(/implausible min speed/);
  });

  it('never leaves a min above the max, whichever order they arrive in', () => {
    for (const limits of [{ min: 7 }, { max: 0.2 }, { min: 5, max: 2 }, { max: 2, min: 5 }]) {
      const d = adoptSpeedLimits(pad(), limits);
      expect(d.minSpeedKmh).toBeLessThanOrEqual(d.maxSpeedKmh);
    }
  });

  it('still takes a min and max that are plausible together', () => {
    // Both sit above the current default max, so neither can be judged on its own.
    const d = adoptSpeedLimits(pad(), { min: 7, max: 10 });
    expect(d.minSpeedKmh).toBe(7);
    expect(d.maxSpeedKmh).toBe(10);
  });
});

describe('detectDriver', () => {
  const padWith = (uuid: string | number) =>
    new FakeServer().addService(uuid, [new FakeCharacteristic('x')]);

  const cases: [string, string | number, string][] = [
    ['classic', UUID.classicService, 'classic'],
    ['FTMS', UUID.ftmsService, 'ftms'],
    ['0x1234', UUID.ks1234Service, 'ks1234'],
    ['FitShow', UUID.fitshowService, 'fitshow'],
  ];

  for (const [name, uuid, id] of cases) {
    it(`recognises a ${name} pad from the service table`, async () => {
      const d = await detectDriver(padWith(uuid) as unknown as BluetoothRemoteGATTServer);
      expect(d?.id).toBe(id);
    });

    // Reading the table is only an optimisation, so it must never be the reason a pad
    // goes unrecognised — a stack without enumeration still gets probed one by one.
    it(`recognises a ${name} pad on a stack that cannot enumerate services`, async () => {
      const server = padWith(uuid);
      server.enumerable = false;
      const d = await detectDriver(server as unknown as BluetoothRemoteGATTServer);
      expect(d?.id).toBe(id);
    });
  }

  it('prefers the classic protocol when a pad offers more than one', async () => {
    const server = padWith(UUID.classicService).addService(UUID.ftmsService, []);
    const d = await detectDriver(server as unknown as BluetoothRemoteGATTServer);
    expect(d?.id).toBe('classic');
  });

  it('reads the service table once rather than probing each candidate', async () => {
    const server = padWith(UUID.fitshowService); // last in the preference order
    const probes: unknown[] = [];
    const probe = server.getPrimaryService.bind(server);
    server.getPrimaryService = async (u) => {
      probes.push(u);
      return probe(u);
    };
    expect((await detectDriver(server as unknown as BluetoothRemoteGATTServer))?.id).toBe(
      'fitshow'
    );
    expect(probes).toHaveLength(0);
  });

  it('gives up on a device with none of the four services', async () => {
    const d = await detectDriver(padWith(0x1815) as unknown as BluetoothRemoteGATTServer);
    expect(d).toBeNull();
  });
});
