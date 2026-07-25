// BLE protocol drivers for KingSmith / WalkingPad treadmills.
//
// Three families exist in the KS+Fit app (com.kingsmith.xiaojin 6.5.6, package `ks_blue`):
//
//   classic  0000fe00  notify fe01  write fe02   older chip:2 units (A1, C1, C2, P1, R1/R2, K12, T1)
//   ftms     00001826  notify 2acd  write 2ad9   newer chip:5 units (Z1, Z3, P1E, MT1, W1, X21, G2, ...)
//   fitshow  0000fff0  notify fff1  write fff2   some OEM units
//
// Each factory returns the same shape so app.js never branches on protocol:
//
//   { id, name, capabilities, maxSpeedKmh, attach(server), detach(),
//     start(), stop(), setSpeed(kmh), setMode(mode), poll() }
//
// and reports telemetry through an `onData` callback set by the caller:
//
//   { speedKmh, distKm, steps, secs, kcal, state, mode, raw }
//
// Fields the device does not report are `null`, never 0 — the UI shows those as an em dash
// rather than inventing a number.

export const UUID = {
  classicService: 0xfe00,
  classicNotify: 0xfe01,
  classicWrite: 0xfe02,

  ftmsService: 0x1826,
  ftmsTreadmillData: 0x2acd,
  ftmsControlPoint: 0x2ad9,
  ftmsStatus: 0x2ada,
  ftmsFeature: 0x2acc,
  ftmsSpeedRange: 0x2ad4,

  fitshowService: 0xfff0,
  fitshowNotify: 0xfff1,
  fitshowWrite: 0xfff2,

  // KingSmith proprietary, chip:3 (KS-C2, G1, G1 Pro, MX16, X21, K12 Pro, KS-K9).
  // Characteristics confirmed by GATT dump on a real KS-C2 — note they are fed7/fed8, NOT the
  // 00011234/00021234 pair that also appears in libapp.so.
  ks1234Service: 0x1234,
  ks1234Write: '0000fed7-0000-1000-8000-00805f9b34fb',
  ks1234Notify: '0000fed8-0000-1000-8000-00805f9b34fb',

  deviceInfo: 0x180a,
  battery: 0x180f,
};

const hex = (buf) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join(' ');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Some stacks reject writeValueWithoutResponse; fall back to the with-response form.
async function writeChar(ch, bytes) {
  const data = new Uint8Array(bytes);
  if (ch.properties.writeWithoutResponse) {
    try {
      await ch.writeValueWithoutResponse(data);
      return;
    } catch (e) {
      if (!ch.properties.write) throw e;
    }
  }
  await ch.writeValue(data);
}

// ---------------------------------------------------------------------------
// Classic WalkingPad — service 0xfe00
// ---------------------------------------------------------------------------
//
// Command frame: F7 A2 <cmd> <param> <crc> FD   where crc = (0xA2 + cmd + param) & 0xFF
// Notification:  F8 A2 ... (18 B current status)  /  F8 A7 ... (last session record)
// Multi-byte integers are big-endian.
//
// The pad does not push status on its own, so we poll `askStats()` on a timer.

export const CLASSIC_MODE = { auto: 0, manual: 1, standby: 2 };

// Belt-state codes are not spelled out anywhere in the app; these labels are the community
// reading and the UI shows the raw number next to them so a mismatch is visible.
const BELT_STATE = {
  0: 'standby',
  1: 'starting',
  2: 'running',
  3: 'stopping',
  4: 'idle',
  5: 'stopped',
  9: 'starting',
};

function classicFrame(cmd, param) {
  const body = [0xa2, cmd, param & 0xff];
  const crc = body.reduce((a, b) => a + b, 0) & 0xff;
  return [0xf7, ...body, crc, 0xfd];
}

function be(view, offset, width = 3) {
  let v = 0;
  for (let i = 0; i < width; i++) v = (v << 8) | view.getUint8(offset + i);
  return v >>> 0;
}

export function classicDriver() {
  let notifyCh = null;
  let writeCh = null;
  let onNotify = null;

  const self = {
    id: 'classic',
    name: 'WalkingPad (classic fe00)',
    capabilities: {
      speed: true,
      mode: true,
      incline: false,
      steps: true,
      pause: false,
      needsPolling: true,
    },
    maxSpeedKmh: 6,
    minSpeedKmh: 0.5,
    speedStep: 0.5,
    onData: null,
    onLog: null,

    async attach(server) {
      const svc = await server.getPrimaryService(UUID.classicService);
      notifyCh = await svc.getCharacteristic(UUID.classicNotify);
      writeCh = await svc.getCharacteristic(UUID.classicWrite);

      onNotify = (e) => self._parse(e.target.value);
      notifyCh.addEventListener('characteristicvaluechanged', onNotify);
      await notifyCh.startNotifications();

      // Wake the pad's app-control path before anything else.
      await self.poll();
    },

    async detach() {
      if (notifyCh && onNotify) {
        notifyCh.removeEventListener('characteristicvaluechanged', onNotify);
        try {
          await notifyCh.stopNotifications();
        } catch {
          /* device already gone */
        }
      }
      notifyCh = writeCh = onNotify = null;
    },

    async _send(cmd, param) {
      const frame = classicFrame(cmd, param);
      self.onLog?.(`tx ${hex(new Uint8Array(frame).buffer)}`);
      await writeChar(writeCh, frame);
      // The pad drops commands sent back to back.
      await sleep(120);
    },

    poll: () => self._send(0, 0),
    setMode: (mode) => self._send(2, mode),

    async setSpeed(kmh) {
      await self._send(1, Math.round(kmh * 10));
    },

    async start() {
      await self.setMode(CLASSIC_MODE.manual);
      await self._send(4, 1);
    },

    async stop() {
      await self.setSpeed(0);
      await self.setMode(CLASSIC_MODE.standby);
    },

    async pause() {
      // The fe00 command set is stats / speed / mode / start and nothing else. Speed 0
      // without the standby that follows it in stop() would be the obvious candidate,
      // but whether the belt picks up again from there has never been checked on a pad.
      throw new Error('the classic fe00 protocol has no pause command');
    },

    _parse(view) {
      self.onLog?.(`rx ${hex(view.buffer)}`);
      if (view.byteLength < 3) return;
      const h0 = view.getUint8(0);
      const h1 = view.getUint8(1);
      if (h0 !== 0xf8) return;

      // Current status
      if (h1 === 0xa2 && view.byteLength >= 17) {
        const state = view.getUint8(2);
        self.onData?.({
          speedKmh: view.getUint8(3) / 10,
          mode: view.getUint8(4),
          secs: be(view, 5),
          distKm: be(view, 8) / 100,
          steps: be(view, 11),
          kcal: null, // classic protocol does not report calories
          state,
          stateLabel: BELT_STATE[state] ?? `state ${state}`,
          raw: hex(view.buffer),
        });
        return;
      }

      // Last-session record
      if (h1 === 0xa7 && view.byteLength >= 17) {
        self.onLog?.(
          `last session: ${be(view, 8)}s  ${(be(view, 11) / 100).toFixed(2)}km  ${be(view, 14)} steps`
        );
      }
    },
  };

  return self;
}

// ---------------------------------------------------------------------------
// FTMS — service 0x1826 (Bluetooth SIG Fitness Machine Service)
// ---------------------------------------------------------------------------

// The spec spends one op code on "Start or Resume" and one on "Stop or Pause"; the
// parameter below is what separates a pause from a stop, and resume needs no parameter
// because it is the same op code as start.
const FTMS_OP = {
  requestControl: 0x00,
  reset: 0x01,
  setTargetSpeed: 0x02,
  startOrResume: 0x07,
  stopOrPause: 0x08,
};

const FTMS_STOP_PARAM = { stop: 0x01, pause: 0x02 };

const FTMS_RESULT = {
  0x01: 'success',
  0x02: 'op code not supported',
  0x03: 'invalid parameter',
  0x04: 'operation failed',
  0x05: 'control not permitted',
};

// Fitness Machine Status (0x2ADA) opcodes we care to surface.
const FTMS_STATUS = {
  0x01: 'reset',
  0x02: 'stopped by user',
  0x03: 'paused by user',
  0x04: 'stopped by safety key',
  0x05: 'started by user',
  0x08: 'target speed changed',
  0x0d: 'stopped by control point',
};

// Treadmill Data (0x2ACD): uint16 flags, then present fields in spec order. Layout varies per
// device, so walk the flags with a cursor rather than using fixed offsets.
export function parseTreadmillData(view) {
  const flags = view.getUint16(0, true);
  let o = 2;
  const out = { raw: hex(view.buffer) };
  const u8 = () => view.getUint8(o++);
  const u16 = () => {
    const v = view.getUint16(o, true);
    o += 2;
    return v;
  };
  const s16 = () => {
    const v = view.getInt16(o, true);
    o += 2;
    return v;
  };
  const u24 = () => {
    const v = view.getUint8(o) | (view.getUint8(o + 1) << 8) | (view.getUint8(o + 2) << 16);
    o += 3;
    return v;
  };
  const has = (bit) => (flags & (1 << bit)) !== 0;

  // bit 0 is "More Data" — instantaneous speed is present when it is CLEAR.
  if (!has(0)) out.speedKmh = u16() / 100;
  if (has(1)) out.avgSpeedKmh = u16() / 100;
  if (has(2)) out.distKm = u24() / 1000;
  if (has(3)) {
    out.inclinePct = s16() / 10;
    out.rampAngleDeg = s16() / 10;
  }
  if (has(4)) {
    out.elevGainUpM = u16() / 10;
    out.elevGainDownM = u16() / 10;
  }
  if (has(5)) out.paceKmPerMin = u8() / 10;
  if (has(6)) out.avgPaceKmPerMin = u8() / 10;
  if (has(7)) {
    out.kcal = u16();
    out.kcalPerHour = u16();
    out.kcalPerMin = u8();
    if (out.kcal === 0xffff) out.kcal = null; // spec's "not available"
  }
  if (has(8)) out.heartRate = u8();
  if (has(9)) out.mets = u8() / 10;
  if (has(10)) out.secs = u16();
  if (has(11)) out.remainingSecs = u16();
  if (has(12)) {
    out.forceOnBeltN = s16();
    out.powerW = s16();
  }
  return out;
}

export function ftmsDriver() {
  let dataCh = null;
  let cpCh = null;
  let statusCh = null;
  let onData = null;
  let onCp = null;
  let onStatus = null;
  let pending = null; // resolver for the current control-point request
  let haveControl = false;

  const self = {
    id: 'ftms',
    name: 'FTMS (standard 1826)',
    capabilities: {
      speed: true,
      mode: false,
      incline: false,
      steps: false,
      pause: true,
      needsPolling: false,
    },
    maxSpeedKmh: 6,
    minSpeedKmh: 0.5,
    speedStep: 0.5,
    onData: null,
    onLog: null,

    async attach(server) {
      const svc = await server.getPrimaryService(UUID.ftmsService);

      // Supported Speed Range tells us exactly what this unit accepts.
      try {
        const rangeCh = await svc.getCharacteristic(UUID.ftmsSpeedRange);
        const r = await rangeCh.readValue();
        self.minSpeedKmh = r.getUint16(0, true) / 100;
        self.maxSpeedKmh = r.getUint16(2, true) / 100;
        self.speedStep = r.getUint16(4, true) / 100 || 0.1;
        self.onLog?.(
          `speed range ${self.minSpeedKmh}–${self.maxSpeedKmh} km/h step ${self.speedStep}`
        );
      } catch {
        self.onLog?.('no 0x2AD4 speed range; using defaults');
      }

      try {
        const featCh = await svc.getCharacteristic(UUID.ftmsFeature);
        const f = await featCh.readValue();
        self.onLog?.(`features ${hex(f.buffer)}`);
      } catch {
        /* optional */
      }

      dataCh = await svc.getCharacteristic(UUID.ftmsTreadmillData);
      onData = (e) => {
        const d = parseTreadmillData(e.target.value);
        self.onData?.({
          speedKmh: d.speedKmh ?? null,
          distKm: d.distKm ?? null,
          secs: d.secs ?? null,
          kcal: d.kcal ?? null,
          steps: null, // FTMS has no step count
          heartRate: d.heartRate ?? null,
          inclinePct: d.inclinePct ?? null,
          state: null,
          stateLabel: null,
          raw: d.raw,
        });
      };
      dataCh.addEventListener('characteristicvaluechanged', onData);
      await dataCh.startNotifications();

      try {
        statusCh = await svc.getCharacteristic(UUID.ftmsStatus);
        onStatus = (e) => {
          const v = e.target.value;
          const op = v.getUint8(0);
          self.onLog?.(`status: ${FTMS_STATUS[op] ?? `op 0x${op.toString(16)}`}`);
        };
        statusCh.addEventListener('characteristicvaluechanged', onStatus);
        await statusCh.startNotifications();
      } catch {
        statusCh = null;
      }

      cpCh = await svc.getCharacteristic(UUID.ftmsControlPoint);
      onCp = (e) => {
        const v = e.target.value;
        if (v.getUint8(0) !== 0x80) return;
        const req = v.getUint8(1);
        const res = v.getUint8(2);
        self.onLog?.(
          `cp ack op 0x${req.toString(16).padStart(2, '0')} → ${FTMS_RESULT[res] ?? res}`
        );
        pending?.({ ok: res === 0x01, result: res });
        pending = null;
      };
      cpCh.addEventListener('characteristicvaluechanged', onCp);
      await cpCh.startNotifications();

      await self._requestControl();
    },

    async detach() {
      for (const [ch, fn] of [
        [dataCh, onData],
        [cpCh, onCp],
        [statusCh, onStatus],
      ]) {
        if (!ch || !fn) continue;
        ch.removeEventListener('characteristicvaluechanged', fn);
        try {
          await ch.stopNotifications();
        } catch {
          /* device already gone */
        }
      }
      dataCh = cpCh = statusCh = onData = onCp = onStatus = null;
      pending = null;
      haveControl = false;
    },

    // Write to the control point and wait for the 0x80 indication that acknowledges it.
    // `soft` hands the rejection back instead of throwing, for the one caller that has
    // somewhere to go when the answer is no: pause.
    async _cp(bytes, { timeout = 3000, soft = false } = {}) {
      self.onLog?.(`tx cp ${hex(new Uint8Array(bytes).buffer)}`);
      const ack = new Promise((resolve) => {
        pending = resolve;
        setTimeout(() => {
          if (pending === resolve) {
            pending = null;
            resolve({ ok: false, result: 'timeout' });
          }
        }, timeout);
      });
      await writeChar(cpCh, bytes);
      const r = await ack;
      if (!r.ok && !soft) {
        throw new Error(
          `treadmill rejected command ${hex(new Uint8Array(bytes).buffer)}: ${
            FTMS_RESULT[r.result] ?? r.result
          }`
        );
      }
      return r;
    },

    async _requestControl() {
      if (haveControl) return;
      await self._cp([FTMS_OP.requestControl]);
      haveControl = true;
    },

    /** Start, and equally resume — 0x07 is "Start or Resume". */
    async start() {
      await self._requestControl();
      await self._cp([FTMS_OP.startOrResume]);
    },

    async stop() {
      await self._requestControl();
      await self._cp([FTMS_OP.stopOrPause, FTMS_STOP_PARAM.stop]);
      haveControl = false; // most units drop control permission on stop
    },

    /**
     * Pause, resumed later by `start()`.
     *
     * Support cannot be discovered up front: FTMS has no pause bit anywhere, not in
     * 0x2ACC Feature nor anywhere else, so the spec's own answer is to send it and read
     * the result. A unit that cannot pause answers "op code not supported" or "invalid
     * parameter" — and the only honest response to that is to stop the belt, because the
     * alternative is a treadmill still running under a button that says Paused.
     */
    async pause() {
      await self._requestControl();
      const r = await self._cp([FTMS_OP.stopOrPause, FTMS_STOP_PARAM.pause], { soft: true });
      haveControl = false; // as with stop, most units hand control back here
      if (r.ok) return 'paused';
      self.onLog?.(
        `pause rejected (${FTMS_RESULT[r.result] ?? r.result}) — this unit has no pause; stopping instead`
      );
      await self.stop();
      return 'stopped';
    },

    async setSpeed(kmh) {
      await self._requestControl();
      const v = Math.round(kmh * 100);
      await self._cp([FTMS_OP.setTargetSpeed, v & 0xff, (v >> 8) & 0xff]);
    },

    async setMode() {
      throw new Error('FTMS has no mode switch');
    },

    async poll() {
      /* FTMS pushes notifications; nothing to poll */
    },
  };

  return self;
}

// ---------------------------------------------------------------------------
// FitShow — service 0xfff0. Detect-and-observe only.
// ---------------------------------------------------------------------------
//
// The framing is not confirmed against a real unit, so this driver subscribes and logs raw
// frames rather than guessing at control commands. If your pad lands here, send me the log
// and we can decode it properly.

export function fitshowDriver() {
  let notifyCh = null;
  let onNotify = null;

  const self = {
    id: 'fitshow',
    name: 'FitShow (fff0) — read-only',
    capabilities: {
      speed: false,
      mode: false,
      incline: false,
      steps: false,
      pause: false,
      needsPolling: false,
    },
    maxSpeedKmh: 6,
    minSpeedKmh: 0.5,
    speedStep: 0.5,
    onData: null,
    onLog: null,

    async attach(server) {
      const svc = await server.getPrimaryService(UUID.fitshowService);
      notifyCh = await svc.getCharacteristic(UUID.fitshowNotify);
      onNotify = (e) => self.onLog?.(`rx ${hex(e.target.value.buffer)}`);
      notifyCh.addEventListener('characteristicvaluechanged', onNotify);
      await notifyCh.startNotifications();
      self.onLog?.(
        'FitShow detected. Control is not implemented — raw frames are logged below so the ' +
          'protocol can be decoded. Please share this log.'
      );
    },

    async detach() {
      if (notifyCh && onNotify) {
        notifyCh.removeEventListener('characteristicvaluechanged', onNotify);
        try {
          await notifyCh.stopNotifications();
        } catch {
          /* device already gone */
        }
      }
      notifyCh = onNotify = null;
    },

    async start() {
      throw new Error('FitShow control is not implemented yet');
    },
    async stop() {
      throw new Error('FitShow control is not implemented yet');
    },
    async pause() {
      throw new Error('FitShow control is not implemented yet');
    },
    async setSpeed() {
      throw new Error('FitShow control is not implemented yet');
    },
    async setMode() {
      throw new Error('FitShow control is not implemented yet');
    },
    async poll() {},
  };

  return self;
}

// ---------------------------------------------------------------------------
// KingSmith 0x1234 (chip:3) — KS-C2, G1, G1 Pro, MX16, X21, K12 Pro, KS-K9
// ---------------------------------------------------------------------------
//
// Decoded from an iOS HCI capture of KS+Fit talking to a real KS-C2.
//
//   transport : write -> fed7, notify <- fed8
//   framing   : ksB64(plaintext) + "\r", split across 20-byte ATT writes
//   payload   : plain text, space separated, e.g. "props CurrentSpeed 1.1"
//
// The base64 alphabet is a permutation of the standard one, lifted from a
// 64-char literal in libapp.so. Index 62 ('Z') never appears in the captured
// traffic, so that one slot is inferred rather than observed.
const KS_B64 = 'SaCw4FGHIJqLhN+P9RVTU/WcY6ObDdefgEijklmnopQrsBuvMxXz1yA2t5078KZ3';
const STD_B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function ksEncode(text) {
  const std = btoa(String.fromCharCode(...new TextEncoder().encode(text)));
  let out = '';
  for (const c of std) {
    const i = STD_B64.indexOf(c);
    out += i < 0 ? c : KS_B64[i]; // '=' passes through
  }
  return out;
}

function ksDecode(cipher) {
  let std = '';
  for (const c of cipher) {
    const i = KS_B64.indexOf(c);
    std += i < 0 ? c : STD_B64[i];
  }
  std += '='.repeat((4 - (std.length % 4)) % 4);
  const bin = atob(std);
  return new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
}

// "props CurrentSpeed 1.1 RunningSteps 11" -> {CurrentSpeed:'1.1', RunningSteps:'11'}
function parseProps(line) {
  const parts = line.trim().split(/\s+/);
  if (parts[0] !== 'props') return null;
  const out = {};
  for (let i = 1; i + 1 < parts.length; i += 2) out[parts[i]] = parts[i + 1].replace(/^"|"$/g, '');
  return out;
}

const num = (v) => (v == null || v === '' ? null : Number(v));

export function ks1234Driver() {
  let writeCh = null;
  let notifyCh = null;
  let onNotify = null;
  let rxBuf = '';
  let closed = false;

  const self = {
    id: 'ks1234',
    name: 'KingSmith 0x1234 (chip:3)',
    capabilities: {
      speed: true,
      mode: false,
      incline: false,
      steps: true,
      pause: false,
      needsPolling: false,
    },
    maxSpeedKmh: 6,
    minSpeedKmh: 0.5,
    speedStep: 0.1,
    onData: null,
    onLog: null,

    async attach(server) {
      closed = false;
      const svc = await server.getPrimaryService(UUID.ks1234Service);
      writeCh = await svc.getCharacteristic(UUID.ks1234Write);
      notifyCh = await svc.getCharacteristic(UUID.ks1234Notify);

      onNotify = (e) => self._rx(e.target.value);
      notifyCh.addEventListener('characteristicvaluechanged', onNotify);
      await notifyCh.startNotifications();

      // The pad drops the link ~2-4s after connecting unless this completes, so it runs
      // immediately and in the same order the official app uses.
      await self._handshake();
    },

    async detach() {
      closed = true;
      if (notifyCh && onNotify) {
        notifyCh.removeEventListener('characteristicvaluechanged', onNotify);
        try {
          await notifyCh.stopNotifications();
        } catch {
          /* device already gone */
        }
      }
      writeCh = notifyCh = onNotify = null;
      rxBuf = '';
    },

    // Encode, terminate with CR, and fragment to 20 bytes — the app's MTU payload size.
    async _send(text) {
      if (closed || !writeCh) return;
      self.onLog?.(`--> ${text}`);
      const frame = new TextEncoder().encode(ksEncode(text) + '\r');
      for (let i = 0; i < frame.length; i += 20) {
        await writeChar(writeCh, frame.slice(i, i + 20));
        await sleep(30);
      }
      await sleep(60);
    },

    async _handshake() {
      const posix = Math.floor(Date.now() / 1000);
      await self._send('shake');
      await self._send(`time_posix ${posix}`);
      await self._send('version');
      // Property id list the app asks for on connect — device config and limits.
      await self._send('servers getProp 1 3 7 8 9 16 17 18 19 21 22 23 24 13 15');
      await self._send('props user_id 5980681');
      await self._send('get_pk');
      // ControlMode 1 hands control to the app (2 = the pad's own panel).
      await self._send('props ControlMode 1');
      // Subscribe to the live telemetry set.
      await self._send('servers getProp 1 9 15 2 10 11 12 13 14');
      self.onLog?.('handshake complete');
    },

    start: () => self._send('props runState 1'),
    stop: () => self._send('props runState 0'),
    setSpeed: (kmh) => self._send(`props CurrentSpeed ${kmh.toFixed(1)}`),
    async pause() {
      // KS+Fit does have one for this family — its BLE layer carries setPause alongside
      // setStart/setStop, and it warns "speed adjustment is not supported when the device
      // is paused" — but the capture only ever exercised runState 0 and 1, so the payload
      // is unknown. `props runState 2` is the obvious guess and guessing a control command
      // at a treadmill is not something this driver does. See docs/protocols.md.
      throw new Error(
        'no pause for the KingSmith 0x1234 protocol yet — KS+Fit has one, but its wire ' +
          'format has not been captured'
      );
    },
    async setMode() {
      throw new Error('this protocol has no mode switch');
    },
    async poll() {
      /* the pad pushes telemetry on its own */
    },

    _rx(view) {
      rxBuf += new TextDecoder().decode(view.buffer);
      let i;
      while ((i = rxBuf.indexOf('\r')) >= 0) {
        const chunk = rxBuf.slice(0, i);
        rxBuf = rxBuf.slice(i + 1);
        if (!chunk) continue;
        let line;
        try {
          line = ksDecode(chunk);
        } catch {
          self.onLog?.(`<-- <undecodable> ${chunk}`);
          continue;
        }
        self.onLog?.(`<-- ${line}`);
        self._apply(line);
      }
    },

    _apply(line) {
      const p = parseProps(line);
      if (!p) return;

      if (p.Max != null) self.maxSpeedKmh = Number(p.Max) || self.maxSpeedKmh;
      if (p.StartSpeed != null) self.minSpeedKmh = Number(p.StartSpeed) || self.minSpeedKmh;

      const state = p.runState != null ? Number(p.runState) : null;
      const out = {
        speedKmh: num(p.CurrentSpeed),
        secs: num(p.RunningTotalTime),
        steps: num(p.RunningSteps),
        // Scaling for these two was never exercised in the capture (both stayed 0 over a
        // short walk), so they are passed through raw rather than guessed at.
        distKm: num(p.RunningDistance),
        kcal: num(p.BurnCalories),
        state,
        stateLabel: state == null ? null : state === 0 ? 'stopped' : state === 1 ? 'running' : `state ${state}`,
        raw: line,
      };
      // The pad sends partial updates ("props RunningSteps 3"), and app.js merges each one
      // onto the last. Drop every absent key or a partial message would blank the fields it
      // simply did not mention.
      for (const k of Object.keys(out)) if (out[k] == null) delete out[k];
      if (Object.keys(out).length > 1) self.onData?.(out); // >1 because `raw` is always set
    },
  };

  return self;
}

export { ksEncode, ksDecode, parseProps };

// ---------------------------------------------------------------------------
// Detection — probe the GATT table in the order the app itself prefers.
// ---------------------------------------------------------------------------

export async function detectDriver(server) {
  const candidates = [
    [UUID.classicService, classicDriver],
    [UUID.ftmsService, ftmsDriver],
    [UUID.ks1234Service, ks1234Driver],
    [UUID.fitshowService, fitshowDriver],
  ];
  for (const [uuid, factory] of candidates) {
    try {
      await server.getPrimaryService(uuid);
      return factory();
    } catch {
      /* not this one */
    }
  }
  return null;
}

export { hex };
