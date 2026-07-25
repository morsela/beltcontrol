import { describe, it, expect, beforeEach } from 'vitest';
import { ks1234Driver, ksEncode, ksDecode, parseProps, UUID } from '../src/lib/drivers.js';
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

  it('adopts the limits the pad reports', async () => {
    const { server, notify } = padServer();
    const d = ks1234Driver();
    await d.attach(server as unknown as BluetoothRemoteGATTServer);
    push(notify, 'props Max 6.0 StartSpeed 1.0');
    expect(d.maxSpeedKmh).toBe(6);
    expect(d.minSpeedKmh).toBe(1);
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

  it('stops writing once detached', async () => {
    const { server, write } = padServer();
    const d = ks1234Driver();
    await d.attach(server as unknown as BluetoothRemoteGATTServer);
    await d.detach();
    write.writes.length = 0;
    await d.setSpeed(2);
    expect(write.writes).toHaveLength(0);
  });
});
