import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ks1234Driver, ksEncode, ksDecode, parseProps, installId, UUID } from '../src/lib/drivers.js';
import type { Telemetry } from '../src/lib/drivers.js';
import { FakeServer, FakeCharacteristic } from './ble-mock.js';

describe('the permuted base64 alphabet', () => {
  it('round-trips', () => {
    for (const s of ['shake', 'props CurrentSpeed 1.1', 'props runState 1', 'version', 'a', '']) {
      expect(ksDecode(ksEncode(s))).toBe(s);
    }
  });

  it('is not standard base64 — that is the whole point', () => {
    expect(ksEncode('shake')).not.toBe(btoa('shake'));
  });

  it('round-trips a payload long enough to be fragmented', () => {
    const long = 'servers getProp 1 3 7 8 9 16 17 18 19 21 22 23 24 13 15';
    expect(ksDecode(ksEncode(long))).toBe(long);
  });

  it('decodes without the padding the pad omits', () => {
    const cipher = ksEncode('props runState 1').replace(/=+$/, '');
    expect(ksDecode(cipher)).toBe('props runState 1');
  });
});

describe('parseProps', () => {
  it('reads key/value pairs', () => {
    expect(parseProps('props CurrentSpeed 1.1 RunningSteps 11')).toEqual({
      CurrentSpeed: '1.1',
      RunningSteps: '11',
    });
  });

  it('strips the quotes the pad puts around string values', () => {
    expect(parseProps('props Name "KS-C2"')).toEqual({ Name: 'KS-C2' });
  });

  it('tolerates the pad’s irregular whitespace', () => {
    expect(parseProps('  props   runState  1  ')).toEqual({ runState: '1' });
  });

  it('ignores a dangling key with no value', () => {
    expect(parseProps('props runState 1 CurrentSpeed')).toEqual({ runState: '1' });
  });

  it('rejects lines that are not props', () => {
    expect(parseProps('version 1.2.3')).toBeNull();
    expect(parseProps('')).toBeNull();
  });
});

// --- driver ---------------------------------------------------------------

function padServer() {
  const write = new FakeCharacteristic(UUID.ks1234Write);
  const notify = new FakeCharacteristic(UUID.ks1234Notify);
  return { server: new FakeServer().addService(UUID.ks1234Service, [write, notify]), write, notify };
}

/** Everything written so far, defragmented and decoded back to plain text. */
function lines(write: FakeCharacteristic): string[] {
  return write.textWrites().split('\r').filter(Boolean).map(ksDecode);
}

/** Frame a line the way the pad does: encoded, CR-terminated, in ≤20-byte chunks. */
function push(notify: FakeCharacteristic, line: string, chunk = 20) {
  const bytes = new TextEncoder().encode(ksEncode(line) + '\r');
  for (let i = 0; i < bytes.length; i += chunk) notify.emit(bytes.slice(i, i + chunk));
}

describe('ks1234Driver', () => {
  let seen: Partial<Telemetry>[];

  beforeEach(() => {
    seen = [];
  });

  it('completes the handshake the pad requires to keep the link up', async () => {
    // Without this the pad drops the connection 2–4 s after connecting.
    const { server, write } = padServer();
    const d = ks1234Driver();
    await d.attach(server as unknown as BluetoothRemoteGATTServer);
    const sent = lines(write);
    expect(sent[0]).toBe('shake');
    expect(sent.some((l) => l.startsWith('time_posix '))).toBe(true);
    expect(sent).toContain('props ControlMode 1'); // hands control to the app
    expect(sent.filter((l) => l.startsWith('servers getProp'))).toHaveLength(2);
  });

  it('sends a per-install user_id, not the account id from the capture', async () => {
    const { server, write } = padServer();
    const d = ks1234Driver();
    await d.attach(server as unknown as BluetoothRemoteGATTServer);
    const sent = lines(write);
    const line = sent.find((l) => l.startsWith('props user_id '))!;
    expect(line).toBeDefined();
    // A real KS+Fit account id from someone's packet capture has no business here.
    expect(line).not.toContain('5980681');
    expect(line).toMatch(/^props user_id \d+$/);
  });

  it('keeps the same user_id across connections in one browser', async () => {
    const first = padServer();
    const a = ks1234Driver();
    await a.attach(first.server as unknown as BluetoothRemoteGATTServer);
    const second = padServer();
    const b = ks1234Driver();
    await b.attach(second.server as unknown as BluetoothRemoteGATTServer);
    const id = (w: typeof first.write) =>
      lines(w).find((l) => l.startsWith('props user_id '));
    expect(id(first.write)).toBe(id(second.write));
  });

  it('still produces a usable id when storage is unavailable', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('private mode');
    });
    expect(installId()).toMatch(/^\d+$/);
    getItem.mockRestore();
  });

  // The bug this guards: stopping hands control back to the pad's own panel, and in panel
  // mode `runState 1` is accepted and ignored, so only the first start of a session worked.
  it('re-takes control on every start, not just the one after the handshake', async () => {
    const { server, write } = padServer();
    const d = ks1234Driver();
    await d.attach(server as unknown as BluetoothRemoteGATTServer);
    write.writes.length = 0;

    await d.start();
    await d.stop();
    await d.start();

    expect(lines(write)).toEqual([
      'props ControlMode 1',
      'props runState 1',
      'props runState 0',
      'props ControlMode 1',
      'props runState 1',
    ]);
  });

  // The pad answers a start it will not honour, and it answers within the same second.
  // Reading that answer is the difference between knowing in one second and guessing
  // after ten — see the `startVerdict` note in drivers.js.
  describe('the pad’s answer to a start', () => {
    async function started() {
      const { server, write, notify } = padServer();
      const d = ks1234Driver();
      const logs: string[] = [];
      d.onLog = (m) => logs.push(m);
      await d.attach(server as unknown as BluetoothRemoteGATTServer);
      write.writes.length = 0;
      await d.start();
      return { d, write, notify, logs };
    }

    it('reads a vendor error code as the pad refusing', async () => {
      const { d, notify } = await started();
      // Exactly what a real KS-C2 sends. Note the odd token count: `parseProps` pairs
      // tokens off two at a time and cannot read this line, which is why the driver
      // matches the raw text instead.
      push(notify, 'props Error ErrorCode -5000');
      await expect(d.startVerdict!()).resolves.toBe('refused');
    });

    it('reads the whole vendor band, not just the one code seen on this pad', async () => {
      // MIoT hands -9999..-5000 to the vendor to define. A sibling model answering -5003
      // is saying the same thing in its own dialect.
      for (const code of [-5000, -5003, -9999]) {
        const { d, notify } = await started();
        push(notify, `props Error ErrorCode ${code}`);
        await expect(d.startVerdict!()).resolves.toBe('refused');
      }
    });

    it('leaves MIoT’s own error codes alone — none of them mean refused', async () => {
      const { d, notify } = await started();
      push(notify, 'props Error ErrorCode -4003'); // "property does not exist"
      push(notify, 'props ControlMode 1');
      await expect(d.startVerdict!()).resolves.toBe('accepted');
    });

    it('reads the pad still holding control on its own panel as a refusal', async () => {
      // Per `start()`: in panel mode `runState 1` is accepted and ignored. The pad saying
      // it kept control is the pad saying the start will do nothing.
      const { d, notify, logs } = await started();
      push(notify, 'props ControlMode 2 ChildLockSwitch 0 runState 0 CurrentSpeed 0.0');
      await expect(d.startVerdict!()).resolves.toBe('refused');
      expect(logs.join('\n')).toMatch(/own panel/);
    });

    it('reads the control-mode echo as the pad taking the command', async () => {
      const { d, notify } = await started();
      push(notify, 'props ControlMode 1');
      await expect(d.startVerdict!()).resolves.toBe('accepted');
    });

    // Real timers, and so a genuinely slow test: the driver paces its own writes with
    // sleeps, and faking the clock deadlocks `attach` before the pad can say anything.
    it('says nothing either way when the pad says nothing', async () => {
      const { d } = await started();
      // Not 'accepted': silence is not consent. The caller falls back to waiting for the
      // belt to actually move, exactly as it does on every other protocol.
      await expect(d.startVerdict!()).resolves.toBe('unknown');
    }, 10_000);

    it('keeps the first answer, ignoring what the pad says afterwards', async () => {
      const { d, notify } = await started();
      push(notify, 'props Error ErrorCode -5000');
      push(notify, 'props ControlMode 1');
      await expect(d.startVerdict!()).resolves.toBe('refused');
    });

    it('settles a start left in flight when the link goes', async () => {
      // Nothing is going to answer now; a caller awaiting this must not hang on it.
      const { d } = await started();
      const verdict = d.startVerdict!();
      await d.detach();
      await expect(verdict).resolves.toBe('unknown');
    });

    it('gives each start its own window', async () => {
      const { d, notify } = await started();
      const first = d.startVerdict!();
      await d.start(); // supersedes it before the pad ever answered
      push(notify, 'props ControlMode 1');
      await expect(first).resolves.toBe('unknown');
      await expect(d.startVerdict!()).resolves.toBe('accepted');
    });

    it('is not fooled by a control-mode line arriving outside a start', async () => {
      const { server, notify } = padServer();
      const d = ks1234Driver();
      await d.attach(server as unknown as BluetoothRemoteGATTServer);
      push(notify, 'props ControlMode 1');
      // No start has been written, so there is nothing for the pad to have accepted.
      await expect(d.startVerdict!()).resolves.toBe('unknown');
    });
  });

  // Settled by the play–pause–play–pause capture: KS+Fit's pause is `props runState 0`,
  // byte for byte the stop, and the pad itself is what makes it resumable — its session
  // counters survive the gap. See "Pause is runState 0" in docs/protocols.md.
  describe('pause', () => {
    it('is offered — the wire format is captured now', () => {
      expect(ks1234Driver().capabilities.pause).toBe(true);
    });

    it('sends runState 0 and reports paused', async () => {
      const { server, write } = padServer();
      const d = ks1234Driver();
      await d.attach(server as unknown as BluetoothRemoteGATTServer);
      write.writes.length = 0;
      await expect(d.pause()).resolves.toBe('paused');
      expect(lines(write)).toEqual(['props runState 0']);
    });

    it('resumes through start(), re-taking control the pause handed back', async () => {
      // Stopping — and pause is a stop on the wire — hands control back to the pad's own
      // panel, where a bare `runState 1` is accepted and ignored. The resume has to
      // re-assert ControlMode exactly as any start does.
      const { server, write } = padServer();
      const d = ks1234Driver();
      await d.attach(server as unknown as BluetoothRemoteGATTServer);
      write.writes.length = 0;
      await d.pause();
      await d.start();
      expect(lines(write)).toEqual([
        'props runState 0',
        'props ControlMode 1',
        'props runState 1',
      ]);
    });

    it('refuses on a detached link rather than resolving', async () => {
      // A resolved pause() is read upstream as the belt having been told to pause.
      const { server, write } = padServer();
      const d = ks1234Driver();
      await d.attach(server as unknown as BluetoothRemoteGATTServer);
      await d.detach();
      write.writes.length = 0;
      await expect(d.pause()).rejects.toThrow(/not connected/);
      expect(write.writes).toHaveLength(0);
    });
  });

  // fed8 carries more than the text protocol: interleaved with the props lines, the pad
  // pushes short raw binary frames. Both of these are byte for byte from the play–pause
  // capture — a time-sync request and, after KS+Fit answered on a third characteristic,
  // its ack. See "Binary sidecar" in docs/protocols.md.
  describe('binary sidecar frames on fed8', () => {
    const REQUEST = [0x1f, 0x04, 0x08, 0x03, 0x05, 0x00];
    const ACK = [0x13, 0x05, 0xfa, 0x5f, 0x65, 0x0a, 0x00];

    async function attached() {
      const { server, notify } = padServer();
      const d = ks1234Driver();
      const logs: string[] = [];
      d.onLog = (m) => logs.push(m);
      d.onData = (t) => seen.push(t);
      await d.attach(server as unknown as BluetoothRemoteGATTServer);
      return { d, notify, logs };
    }

    it('does not let a binary frame eat the text line that follows it', async () => {
      // Appended to the line buffer, these bytes glue onto the next line and ksDecode
      // refuses the lot — in the capture that dropped `props CurrentSpeed 0.5`.
      const { notify } = await attached();
      notify.emit(REQUEST);
      notify.emit(ACK);
      push(notify, 'props CurrentSpeed 0.5');
      expect(seen).toHaveLength(1);
      expect(seen[0]!.speedKmh).toBe(0.5);
    });

    it('leaves a text line alone when a binary frame lands between its fragments', async () => {
      // The sidecar is its own stream, not part of this one: a frame arriving between
      // two 20-byte fragments of a props line must not break the reassembly.
      const { notify } = await attached();
      const line = new TextEncoder().encode(ksEncode('props CurrentSpeed 0.5') + '\r');
      notify.emit(line.slice(0, 7));
      notify.emit(REQUEST);
      notify.emit(line.slice(7));
      expect(seen).toHaveLength(1);
      expect(seen[0]!.speedKmh).toBe(0.5);
    });

    it('publishes no telemetry for a binary frame', async () => {
      const { notify } = await attached();
      notify.emit(REQUEST);
      notify.emit(ACK);
      expect(seen).toHaveLength(0);
    });

    it('logs the frame as hex, so it is on record for decoding one day', async () => {
      const { notify, logs } = await attached();
      notify.emit(REQUEST);
      expect(logs.join('\n')).toMatch(/binary sidecar frame 1f 04 08 03 05 00/);
    });
  });

  it('never interleaves the fragments of two messages', async () => {
    // The pad reassembles one stream and splits it on CR, so a message written into the
    // middle of another one's fragments decodes to garbage and is silently dropped.
    const { server, write } = padServer();
    const d = ks1234Driver();
    await d.attach(server as unknown as BluetoothRemoteGATTServer);
    write.writes.length = 0;

    await Promise.all([d.start(), d.setSpeed(3.2), d.stop()]);

    expect(lines(write).sort()).toEqual(
      ['props ControlMode 1', 'props CurrentSpeed 3.2', 'props runState 0', 'props runState 1'].sort()
    );
  });

  it('sends speed with one decimal', async () => {
    const { server, write } = padServer();
    const d = ks1234Driver();
    await d.attach(server as unknown as BluetoothRemoteGATTServer);
    write.writes.length = 0;
    await d.setSpeed(3.218688); // 2.0 mph
    expect(lines(write)).toEqual(['props CurrentSpeed 3.2']);
  });

  it('fragments a long line to the 20-byte MTU payload and still reassembles', async () => {
    const { server, write } = padServer();
    const d = ks1234Driver();
    await d.attach(server as unknown as BluetoothRemoteGATTServer);
    const long = write.writes.filter((w) => w.length > 20);
    expect(long).toHaveLength(0);
    expect(lines(write)).toContain('servers getProp 1 3 7 8 9 16 17 18 19 21 22 23 24 13 15');
  });

  it('reassembles a line split across notifications', async () => {
    const { server, notify } = padServer();
    const d = ks1234Driver();
    d.onData = (t) => seen.push(t);
    await d.attach(server as unknown as BluetoothRemoteGATTServer);
    push(notify, 'props CurrentSpeed 1.1 RunningSteps 11 RunningTotalTime 60', 7);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.speedKmh).toBe(1.1);
    expect(seen[0]!.steps).toBe(11);
    expect(seen[0]!.secs).toBe(60);
  });

  it('emits one update per line when several arrive in one notification', async () => {
    const { server, notify } = padServer();
    const d = ks1234Driver();
    d.onData = (t) => seen.push(t);
    await d.attach(server as unknown as BluetoothRemoteGATTServer);
    const two = new TextEncoder().encode(
      ksEncode('props CurrentSpeed 1.1') + '\r' + ksEncode('props RunningSteps 11') + '\r'
    );
    notify.emit(two);
    expect(seen).toHaveLength(2);
  });

  it('reads distance as metres and calories as gram-calories', async () => {
    // From the 19:54 KS-C2 capture: RunningDistance 20 after 41s at ~2.6 km/h is
    // 20 metres, not 20 km. Calories share the thousandth scale.
    const { server, notify } = padServer();
    const d = ks1234Driver();
    d.onData = (t) => seen.push(t);
    await d.attach(server as unknown as BluetoothRemoteGATTServer);
    push(notify, 'props RunningTotalTime 41 RunningSteps 58 RunningDistance 20 BurnCalories 1250');
    expect(seen[0]!.distKm).toBe(0.02);
    expect(seen[0]!.kcal).toBe(1.25);
  });

  it('leaves a thousandth-scaled field absent rather than zero when unmentioned', async () => {
    // `null / 1000` is 0, so a careless scale would turn "this frame said nothing about
    // distance" into a real zero and blank the merged value.
    const { server, notify } = padServer();
    const d = ks1234Driver();
    d.onData = (t) => seen.push(t);
    await d.attach(server as unknown as BluetoothRemoteGATTServer);
    push(notify, 'props RunningSteps 3');
    expect(seen[0]).not.toHaveProperty('distKm');
    expect(seen[0]).not.toHaveProperty('kcal');
  });

  it('drops absent keys so a partial frame cannot blank the display', async () => {
    // The pad sends updates like "props RunningSteps 3"; every other field must
    // be left off entirely rather than sent as null.
    const { server, notify } = padServer();
    const d = ks1234Driver();
    d.onData = (t) => seen.push(t);
    await d.attach(server as unknown as BluetoothRemoteGATTServer);
    push(notify, 'props RunningSteps 3');
    expect(Object.keys(seen[0]!).sort()).toEqual(['raw', 'steps']);
  });

  it('says nothing when a props line carries no field it understands', async () => {
    const { server, notify } = padServer();
    const d = ks1234Driver();
    d.onData = (t) => seen.push(t);
    await d.attach(server as unknown as BluetoothRemoteGATTServer);
    push(notify, 'props Unrelated 7');
    expect(seen).toHaveLength(0);
  });

  it('drops a value that is not a number rather than publishing NaN', async () => {
    // NaN survives the absent-key strip, and once it is in `live` the belt is neither
    // moving nor stopped: isMoving is false and confirmedStopped is false, so a stop
    // can never confirm and the readout says NaN.
    const { server, notify } = padServer();
    const d = ks1234Driver();
    d.onData = (t) => seen.push(t);
    await d.attach(server as unknown as BluetoothRemoteGATTServer);
    push(notify, 'props CurrentSpeed --');
    expect(seen).toHaveLength(0);
  });

  it('keeps the readable fields of a line whose other values are junk', async () => {
    const { server, notify } = padServer();
    const d = ks1234Driver();
    d.onData = (t) => seen.push(t);
    await d.attach(server as unknown as BluetoothRemoteGATTServer);
    push(notify, 'props CurrentSpeed n/a RunningSteps 11');
    expect(Object.keys(seen[0]!).sort()).toEqual(['raw', 'steps']);
  });

  it('adopts the limits the pad reports', async () => {
    const { server, notify } = padServer();
    const d = ks1234Driver();
    await d.attach(server as unknown as BluetoothRemoteGATTServer);
    push(notify, 'props Max 6.0 StartSpeed 1.5');
    expect(d.maxSpeedKmh).toBe(6);
    expect(d.minSpeedKmh).toBe(1.5);
  });

  it('refuses limits outside the app’s own envelope', async () => {
    const { server, notify } = padServer();
    const d = ks1234Driver();
    const logs: string[] = [];
    d.onLog = (m) => logs.push(m);
    await d.attach(server as unknown as BluetoothRemoteGATTServer);
    push(notify, 'props Max 99.0 StartSpeed 0.01');
    expect(d.maxSpeedKmh).toBe(6); // default kept
    expect(d.minSpeedKmh).toBe(1); // a start speed under the floor is raised to it
    expect(logs.join('\n')).toMatch(/implausible max speed/);
    expect(logs.join('\n')).toMatch(/below the 1 km\/h floor/);
  });

  it('refuses a minimum that arrives on its own above the maximum', async () => {
    // The pad reports StartSpeed and Max in separate frames, so a minimum can land
    // above a maximum that is still the 6.0 default. SpeedControl then reads the belt
    // as being at its minimum and its maximum at once and disables both steppers.
    const { server, notify } = padServer();
    const d = ks1234Driver();
    const logs: string[] = [];
    d.onLog = (m) => logs.push(m);
    await d.attach(server as unknown as BluetoothRemoteGATTServer);
    push(notify, 'props StartSpeed 7.0');
    expect(d.minSpeedKmh).toBeLessThanOrEqual(d.maxSpeedKmh);
    expect(d.minSpeedKmh).toBe(1.0);
    expect(logs.join('\n')).toMatch(/implausible min speed/);
  });

  it('labels run state', async () => {
    const { server, notify } = padServer();
    const d = ks1234Driver();
    d.onData = (t) => seen.push(t);
    await d.attach(server as unknown as BluetoothRemoteGATTServer);
    push(notify, 'props runState 1');
    expect(seen[0]!.stateLabel).toBe('running');
    push(notify, 'props runState 0');
    expect(seen[1]!.stateLabel).toBe('stopped');
  });

  // Device identity, published on the driver rather than in telemetry: neither field
  // describes the walk, but both answer the first questions behind a bug report — and
  // the lock is the one thing the vendor's own advice checks when a start is refused.
  describe('what the pad says about itself', () => {
    async function attached() {
      const { server, notify } = padServer();
      const d = ks1234Driver();
      const logs: string[] = [];
      d.onLog = (m) => logs.push(m);
      d.onData = (t) => seen.push(t);
      await d.attach(server as unknown as BluetoothRemoteGATTServer);
      return { d, notify, logs };
    }

    it('tracks the child lock, so a refused start can point at it', async () => {
      const { d, notify, logs } = await attached();
      expect(d.childLockOn).toBeNull(); // the pad has not said yet
      push(notify, 'props ControlMode 1 ChildLockSwitch 0 runState 0'); // real config dump shape
      expect(d.childLockOn).toBe(false);
      push(notify, 'props ChildLockSwitch 1');
      expect(d.childLockOn).toBe(true);
      expect(logs.join('\n')).toMatch(/child lock is ON/);
    });

    it('assembles firmware identity from the two replies that carry it', async () => {
      const { d, notify, logs } = await attached();
      expect(d.firmware).toBeNull();
      push(notify, 'version 0014'); // the version command's reply — module firmware
      expect(d.firmware).toBe('module 0014');
      push(notify, 'props mcu_version "0005"'); // from the config dump
      expect(d.firmware).toBe('MCU 0005, module 0014');
      expect(logs.join('\n')).toMatch(/pad firmware: MCU 0005, module 0014/);
    });

    it('publishes neither as telemetry', async () => {
      // Device state stays on the driver; a frame carrying only identity must not
      // reach `live`, where its absent keys would say nothing and its presence would
      // still bump the frame clock.
      const { notify } = await attached();
      push(notify, 'props ChildLockSwitch 1 mcu_version "0005"');
      expect(seen).toHaveLength(0);
    });
  });

  it('logs an undecodable chunk instead of throwing', async () => {
    const { server, notify } = padServer();
    const d = ks1234Driver();
    const logs: string[] = [];
    d.onLog = (m) => logs.push(m);
    d.onData = (t) => seen.push(t);
    await d.attach(server as unknown as BluetoothRemoteGATTServer);
    notify.emit([...new TextEncoder().encode('!!!\r')]);
    push(notify, 'props CurrentSpeed 1.1');
    expect(seen).toHaveLength(1); // the good line still lands
  });

  it('stops writing once detached, and says the command was not sent', async () => {
    const { server, write } = padServer();
    const d = ks1234Driver();
    await d.attach(server as unknown as BluetoothRemoteGATTServer);
    await d.detach();
    write.writes.length = 0;
    // Still writes nothing — but a caller that reports success on a resolved promise
    // would otherwise be reporting a command that never left the building.
    await expect(d.setSpeed(2)).rejects.toThrow(/not connected/);
    expect(write.writes).toHaveLength(0);
  });

  it('gives up quietly when the link goes away between two fragments of a message', async () => {
    // A long line is written 20 bytes at a time. Tearing the link down partway through
    // used to dereference the characteristic that had just been nulled, so a disconnect
    // during the connect handshake surfaced as "Cannot read properties of null".
    let d: ReturnType<typeof ks1234Driver>;
    let torn = false;
    const write = new FakeCharacteristic(UUID.ks1234Write, {
      onWrite: (bytes) => {
        // A full 20 bytes means more fragments of this message are still to come.
        if (bytes.length === 20 && !torn) {
          torn = true;
          void d.detach();
        }
      },
    });
    const notify = new FakeCharacteristic(UUID.ks1234Notify);
    const server = new FakeServer().addService(UUID.ks1234Service, [write, notify]);
    d = ks1234Driver();

    await expect(d.attach(server as unknown as BluetoothRemoteGATTServer)).resolves.toBeUndefined();
    expect(torn).toBe(true); // the tear-down really did land mid-message
  });

  it('refuses stop() on a detached link rather than resolving', async () => {
    const { server, write } = padServer();
    const d = ks1234Driver();
    await d.attach(server as unknown as BluetoothRemoteGATTServer);
    await d.detach();
    write.writes.length = 0;
    await expect(d.stop()).rejects.toThrow(/not connected/);
    expect(write.writes).toHaveLength(0);
  });
});
