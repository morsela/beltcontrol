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

// Takes a buffer, a view of one, or anything array-like. Views are honoured rather than
// unwrapped: `hex(someDataView.buffer)` would print the whole allocation behind a frame,
// and passing the view straight to `new Uint8Array` yields an empty string with no error
// at all — a logged frame that silently vanishes.
const hex = (buf) => {
  const bytes = ArrayBuffer.isView(buf)
    ? new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
    : new Uint8Array(buf);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ');
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One decoder pair for the module — these are not free to build per notification. */
const UTF8 = new TextEncoder();
const UTF8_DECODER = new TextDecoder();

/** Refusing a command outright beats resolving one that never left the building: a
 *  resolved `stop()` is read upstream as the belt having been told to stop. */
const NOT_CONNECTED = 'not connected to the pad — command not sent';

// Web Bluetooth runs one GATT operation at a time per device and rejects anything that
// overlaps ("GATT operation already in progress"). Classic polls on a 1 s timer, so a poll
// lands in the middle of the Start sequence often enough to swallow a command — and a
// swallowed command looks exactly like a pad that ignored you. Every driver funnels its
// writes through one of these so nothing can overlap.
function serialiser() {
  let tail = Promise.resolve();
  return (fn) => {
    const run = tail.then(fn, fn); // run regardless of how the previous op ended
    tail = run.catch(() => {});
    return run;
  };
}

// ---------------------------------------------------------------------------
// Speed-limit envelope
// ---------------------------------------------------------------------------
//
// FTMS and the 0x1234 family both report their own limits, and the app clamps every
// speed it sends to whatever they say. That makes the device the sole authority on how
// fast the belt may be driven — so a unit that misreports (or a peripheral that lies)
// removes the cap rather than tightening it. A stuck 0xFFFF in 0x2AD4 reads as
// 655.35 km/h, and the app would forward it.
//
// These bounds are the app's own opinion, applied on top of whatever the device claims.
// Nothing sold as a walking or running pad exceeds them, and no belt needs a per-press
// step larger than the 0.5 km/h the UI documents.

/** Fast enough for any treadmill this app claims to support, and well under a sprint. */
export const HARD_MAX_KMH = 12;
/** The slowest the app will drive a belt: 1.0 km/h is 0.6 mph, which is where a walking
 *  pad moves off by itself and the lowest speed the ones this app talks to accept. Below
 *  it a "moving" belt is barely distinguishable from a stopped one anyway. */
export const HARD_MIN_KMH = 1.0;
/** The per-press ceiling the UI promises. `speedStep` feeds a stepper, not a slider. */
export const HARD_MAX_STEP_KMH = 0.5;

const inRange = (v, lo, hi) => (Number.isFinite(v) && v >= lo && v <= hi ? v : null);

// ---------------------------------------------------------------------------
// What each protocol can do
// ---------------------------------------------------------------------------
//
// The limits here are where a driver starts, not where it stays: FTMS and 0x1234 both
// rewrite them from what the device reports (see `adoptSpeedLimits`). They are
// deliberately conservative, because a pad that says nothing is a pad we know nothing
// about.
//
// One table rather than one per driver because there are two readers. The simulator
// describes these same four pads so the UI can be exercised without hardware, and it
// used to do that from its own copy — which had already drifted: every simulated pad
// offered a 0.1 km/h step, including the classic one, whose step is 0.5. A fake pad
// that answers differently from the real one is worse than no fake pad at all.

export const PROTOCOLS = {
  classic: {
    capabilities: {
      speed: true,
      mode: true,
      incline: false,
      steps: true,
      pause: false,
      needsPolling: true,
    },
    limits: { minSpeedKmh: HARD_MIN_KMH, maxSpeedKmh: 6, speedStep: 0.5 },
  },
  ftms: {
    capabilities: {
      speed: true,
      mode: false,
      incline: false,
      steps: false,
      pause: true,
      needsPolling: false,
    },
    limits: { minSpeedKmh: HARD_MIN_KMH, maxSpeedKmh: 6, speedStep: 0.5 },
  },
  ks1234: {
    capabilities: {
      speed: true,
      mode: false,
      incline: false,
      steps: true,
      pause: true,
      needsPolling: false,
    },
    limits: { minSpeedKmh: HARD_MIN_KMH, maxSpeedKmh: 6, speedStep: 0.1 },
  },
  fitshow: {
    capabilities: {
      speed: false,
      mode: false,
      incline: false,
      steps: false,
      pause: false,
      needsPolling: false,
    },
    limits: { minSpeedKmh: HARD_MIN_KMH, maxSpeedKmh: 6, speedStep: 0.5 },
  },
};

/**
 * A driver's starting capabilities and limits, as fresh objects it owns outright.
 *
 * Copied rather than shared: the limits are rewritten per connection from what the
 * device says about itself, and two drivers built from the same table must not be able
 * to write over each other — or over the table.
 */
export const protocolDefaults = (id) => ({
  capabilities: { ...PROTOCOLS[id].capabilities },
  ...PROTOCOLS[id].limits,
});

/**
 * Fold device-reported limits into the driver, holding them to the envelope above.
 *
 * Two different things can be wrong with a limit, and they get different answers. A
 * value outside the envelope is a pad talking nonsense: it is refused, the driver keeps
 * its existing conservative default, and the refusal is logged — silently substituting
 * a default would hide the pad that said it. A minimum merely *below the floor* is not
 * nonsense, only slower than this app will drive, so it is raised to the floor instead.
 *
 * Either way the pair has to describe a real range at the end of it, so a bound that
 * would invert the other one is refused however plausible it looked alone.
 */
export function adoptSpeedLimits(self, { min, max, step }, onLog) {
  const note = (what, got, keeping) =>
    onLog?.(`ignoring implausible ${what} from device: ${got} km/h (keeping ${keeping})`);

  const wasMin = self.minSpeedKmh;

  if (min !== undefined) {
    // A pad asking to crawl below the floor is not talking nonsense, it just wants a
    // speed this app will not drive, so that one is raised rather than refused — a
    // refusal would keep a default the device has just told us is wrong for it.
    const v = inRange(min, 0, HARD_MAX_KMH);
    if (v == null) note('min speed', min, self.minSpeedKmh);
    else if (v < HARD_MIN_KMH) {
      onLog?.(
        `device min speed ${min} km/h is below the ${HARD_MIN_KMH} km/h floor — using the floor`
      );
      self.minSpeedKmh = HARD_MIN_KMH;
    } else self.minSpeedKmh = v;
  }
  if (max !== undefined) {
    // A max below the min it is paired with describes no usable range at all.
    const v = inRange(max, Math.max(HARD_MIN_KMH, self.minSpeedKmh), HARD_MAX_KMH);
    if (v == null) note('max speed', max, self.maxSpeedKmh);
    else self.maxSpeedKmh = v;
  }
  // The same holds the other way round, and a lone minimum is how it actually arrives:
  // the 0x1234 pad reports StartSpeed and Max in separate frames, so a min can land
  // above a max that is still the conservative default. The UI reads that pair as the
  // belt being at both ends of its range at once and disables the stepper in both
  // directions, which is a stranger failure than simply not believing the pad.
  if (self.minSpeedKmh > self.maxSpeedKmh) {
    note('min speed', min, wasMin);
    self.minSpeedKmh = wasMin;
  }
  if (step !== undefined) {
    const v = inRange(step, 0.01, HARD_MAX_STEP_KMH);
    if (v == null) note('step', step, self.speedStep);
    else self.speedStep = v;
  }
  return self;
}

// Some stacks reject writeValueWithoutResponse; fall back to the with-response form —
// and remember which characteristics did, so the rest of the session does not pay for a
// rejected GATT operation before every single write. The 0x1234 handshake alone is around
// thirty 20-byte fragment writes.
const noWriteWithoutResponse = new WeakSet();

async function writeChar(ch, bytes) {
  const data = new Uint8Array(bytes);
  if (ch.properties.writeWithoutResponse && !noWriteWithoutResponse.has(ch)) {
    try {
      await ch.writeValueWithoutResponse(data);
      return;
    } catch (e) {
      if (!ch.properties.write) throw e;
      noWriteWithoutResponse.add(ch);
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

/** How long the pad needs to actually leave standby before it will accept a start. */
const CLASSIC_MODE_SETTLE_MS = 400;

export function classicDriver() {
  let notifyCh = null;
  let writeCh = null;
  let onNotify = null;
  const queue = serialiser();

  const self = {
    id: 'classic',
    name: 'WalkingPad (classic fe00)',
    ...protocolDefaults('classic'),
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

    _send(cmd, param) {
      return queue(async () => {
        // Inside the queue, so a dead link comes back as a rejected promise rather than
        // a synchronous throw — `poll()` is called as `poll().catch(...)` on a timer, and
        // a throw would sail straight past that. Without this the write below reaches a
        // characteristic detach() has already nulled and fails as an opaque TypeError.
        self._requireOpen();
        const frame = classicFrame(cmd, param);
        self.onLog?.(`tx ${hex(frame)}`);
        await writeChar(writeCh, frame);
        // The pad drops commands sent back to back.
        await sleep(120);
      });
    },

    _requireOpen() {
      if (!writeCh) throw new Error(NOT_CONNECTED);
    },

    poll: () => self._send(0, 0),
    setMode: (mode) => self._send(2, mode),

    async setSpeed(kmh) {
      await self._send(1, Math.round(kmh * 10));
    },

    async start() {
      // `stop()` leaves the pad in standby, and standby also parks the app-control path —
      // the same path `attach()` has to wake with a poll before anything works. That is why
      // only the first start after connecting used to land: the mode byte was arriving at a
      // pad that was not listening yet, and the start byte 120 ms later found it still in
      // standby. Wake it, switch mode, and let the switch settle before starting the belt.
      await self.poll();
      await self.setMode(CLASSIC_MODE.manual);
      await sleep(CLASSIC_MODE_SETTLE_MS);
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
      self.onLog?.(`rx ${hex(view)}`);
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
          raw: hex(view),
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
/** Thrown internally when the flags word promises a field the frame does not contain. */
const TRUNCATED = Symbol('truncated frame');

export function parseTreadmillData(view) {
  const out = { raw: hex(view) };
  let o = 0;

  // Every read is bounds checked. The flags word is the device's claim about what
  // follows, and nothing guarantees the payload backs it up: a frame whose flags ask
  // for more bytes than it carries used to throw a RangeError straight out of the
  // notification handler, which dropped the frame *and* left `live` frozen at its last
  // value — so the belt could be moving while the screen still read whatever it said
  // before. A short frame is now reported as truncated, keeping whatever fields were
  // fully present.
  const need = (n) => {
    if (o + n > view.byteLength) throw TRUNCATED;
    const at = o;
    o += n;
    return at;
  };
  const u8 = () => view.getUint8(need(1));
  const u16 = () => view.getUint16(need(2), true);
  const s16 = () => view.getInt16(need(2), true);
  const u24 = () => {
    const p = need(3);
    return view.getUint8(p) | (view.getUint8(p + 1) << 8) | (view.getUint8(p + 2) << 16);
  };

  try {
    const flags = u16();
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
  } catch (e) {
    if (e !== TRUNCATED) throw e;
    out.truncated = true;
  }
  return out;
}

/** Telemetry a Treadmill Data frame may or may not carry, per its flags word. */
const FTMS_FRAME_FIELDS = ['speedKmh', 'distKm', 'secs', 'kcal', 'heartRate', 'inclinePct'];

export function ftmsDriver() {
  let dataCh = null;
  let cpCh = null;
  let statusCh = null;
  let onData = null;
  let onCp = null;
  let onStatus = null;
  // The control-point request in flight: { op, resolve }. FTMS echoes the opcode it is
  // answering in byte 1 of every 0x80 indication, so an ack is only an ack for *this*
  // request if that byte matches what was written.
  let pending = null;
  let haveControl = false;
  // There is only one `pending` slot, so two control-point writes in flight at once would
  // hand the first one's ack to the second. Serialise write-and-wait as a unit.
  const queue = serialiser();

  const self = {
    id: 'ftms',
    name: 'FTMS (standard 1826)',
    ...protocolDefaults('ftms'),
    onData: null,
    onLog: null,

    async attach(server) {
      const svc = await server.getPrimaryService(UUID.ftmsService);

      // Supported Speed Range tells us exactly what this unit accepts.
      try {
        const rangeCh = await svc.getCharacteristic(UUID.ftmsSpeedRange);
        const r = await rangeCh.readValue();
        adoptSpeedLimits(
          self,
          {
            min: r.getUint16(0, true) / 100,
            max: r.getUint16(2, true) / 100,
            step: r.getUint16(4, true) / 100 || 0.1,
          },
          self.onLog
        );
        self.onLog?.(
          `speed range ${self.minSpeedKmh}–${self.maxSpeedKmh} km/h step ${self.speedStep}`
        );
      } catch {
        self.onLog?.('no 0x2AD4 speed range; using defaults');
      }

      try {
        const featCh = await svc.getCharacteristic(UUID.ftmsFeature);
        const f = await featCh.readValue();
        self.onLog?.(`features ${hex(f)}`);
      } catch {
        /* optional */
      }

      dataCh = await svc.getCharacteristic(UUID.ftmsTreadmillData);
      onData = (e) => {
        let d;
        try {
          d = parseTreadmillData(e.target.value);
        } catch (err) {
          // Nothing throws from parseTreadmillData any more, but an exception escaping
          // a notification handler is the one failure mode that hides itself: the UI
          // simply stops updating, with a stale speed still on screen. Keep it visible.
          self.onLog?.(`unparseable treadmill frame dropped: ${err?.message ?? err}`);
          return;
        }
        if (d.truncated) {
          self.onLog?.(`truncated treadmill frame (flags promised more than ${d.raw})`);
        }
        // Facts about the protocol rather than about this frame, so they are asserted
        // every time.
        const out = { steps: null, state: null, stateLabel: null, raw: d.raw };
        // Everything else is only published when the frame actually carried it.
        // `undefined` here means "not sent" — the flags word said so, or a truncated
        // frame ran out before reaching it — and flattening that to null blanks whatever
        // the display already knew. A null speed is worse than a blank readout: it is a
        // speed `confirmedStopped` refuses to accept, so a stop could never confirm and
        // the app would report a belt that "is not reporting speed at all" while it was.
        // A field the pad sent as the spec's "not available" is still a null, and still
        // published — that is the device saying something, and it survives the check.
        for (const k of FTMS_FRAME_FIELDS) if (d[k] !== undefined) out[k] = d[k];
        self.onData?.(out);
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
        if (v.byteLength < 3 || v.getUint8(0) !== 0x80) return;
        const req = v.getUint8(1);
        const res = v.getUint8(2);
        const op = `0x${req.toString(16).padStart(2, '0')}`;
        self.onLog?.(`cp ack op ${op} → ${FTMS_RESULT[res] ?? res}`);

        // An ack for an opcode we are not waiting on says nothing about the request that
        // is in flight. Accepting it anyway let a device confirm a command it was never
        // asked to run — a stop reported as acknowledged when the pad only ever
        // acknowledged a speed change.
        if (!pending) {
          self.onLog?.(`unsolicited cp ack ${op} ignored`);
          return;
        }
        if (req !== pending.op) {
          self.onLog?.(
            `cp ack ${op} does not answer the pending 0x${pending.op
              .toString(16)
              .padStart(2, '0')} — ignored`
          );
          return;
        }
        pending.settle({ ok: res === 0x01, result: res });
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
      // An ack can no longer arrive for whatever was in flight, and every control-point
      // write shares one serialiser: dropping the request without settling it leaves its
      // caller waiting forever *and* blocks the queue behind it, so nothing this driver
      // is ever asked to do again would run.
      pending?.settle({ ok: false, result: 'disconnected' });
      pending = null;
      haveControl = false;
    },

    // Write to the control point and wait for the 0x80 indication that acknowledges it.
    // The result code rides on the thrown error, so callers that can do something about a
    // particular rejection — start's reset-retry, pause's fallback — can tell them apart.
    _cp(bytes, { timeout = 3000 } = {}) {
      return queue(async () => {
        const what = hex(bytes);
        self.onLog?.(`tx cp ${what}`);
        const op = bytes[0];
        const ack = new Promise((resolve) => {
          // Keyed by opcode: FTMS echoes the op it is answering, so an indication only
          // settles this request when that byte matches what was written here.
          //
          // Everything that can end this request goes through `settle`, which is safe to
          // call more than once and safe to call on a slot that is no longer the pending
          // one. That is the point: a request has to be able to end even when the thing
          // ending it is not the pad answering.
          const slot = {
            op,
            settle(r) {
              if (pending === slot) pending = null;
              clearTimeout(slot.timer); // otherwise one live timer per command, all session
              resolve(r);
            },
          };
          slot.timer = setTimeout(() => slot.settle({ ok: false, result: 'timeout' }), timeout);
          pending = slot;
        });
        await writeChar(cpCh, bytes);
        const r = await ack;
        if (!r.ok) {
          // A numeric result is the pad's own verdict; a string is the app giving up on
          // ever hearing one, which is not the same thing and should not read like it.
          const err = new Error(
            typeof r.result === 'string'
              ? `command ${what} went unanswered: ${r.result}`
              : `treadmill rejected command ${what}: ${FTMS_RESULT[r.result] ?? r.result}`
          );
          err.result = r.result;
          throw err;
        }
        return r;
      });
    },

    async _requestControl() {
      if (haveControl) return;
      await self._cp([FTMS_OP.requestControl]);
      haveControl = true;
    },

    /** Start, and equally resume — 0x07 is "Start or Resume". */
    async start() {
      await self._requestControl();
      try {
        await self._cp([FTMS_OP.startOrResume]);
      } catch (e) {
        // A unit that never fully left the previous session refuses 0x07 outright, so the
        // second start of a sitting fails where the first succeeded. Reset clears that
        // state; it also revokes control, hence the second request.
        if (e.result !== 0x04 && e.result !== 0x05) throw e;
        self.onLog?.('start refused — resetting the machine and retrying');
        haveControl = false;
        await self._cp([FTMS_OP.reset]);
        await self._requestControl();
        await self._cp([FTMS_OP.startOrResume]);
      }
    },

    async stop() {
      await self._requestControl();
      try {
        await self._cp([FTMS_OP.stopOrPause, FTMS_STOP_PARAM.stop]);
      } finally {
        // Most units drop control permission on stop. Clearing this even when the stop
        // itself failed matters: a stale `true` makes the next start skip Request Control
        // and get silently refused.
        haveControl = false;
      }
    },

    /**
     * Pause, resumed later by `start()`.
     *
     * Support cannot be discovered up front: FTMS has no pause bit anywhere, not in
     * 0x2ACC Feature nor anywhere else, so the spec's own answer is to send it and read
     * the result. A unit that cannot pause answers "op code not supported" or "invalid
     * parameter" — and the only honest response to that is to stop the belt, because the
     * alternative is a treadmill still running under a button that says Paused.
     *
     * Any other rejection is a transient failure rather than a verdict on this unit, so it
     * is thrown like every other one and leaves the button alone.
     */
    async pause() {
      await self._requestControl();
      try {
        await self._cp([FTMS_OP.stopOrPause, FTMS_STOP_PARAM.pause]);
        return 'paused';
      } catch (e) {
        if (e.result !== 0x02 && e.result !== 0x03) throw e;
        self.onLog?.(
          `pause rejected (${FTMS_RESULT[e.result] ?? e.result}) — this unit has no pause; stopping instead`
        );
        // Control survives a "not supported" answer, so stop() will not re-request it.
        await self.stop();
        return 'stopped';
      } finally {
        haveControl = false; // as with stop, most units hand control back here
      }
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
    ...protocolDefaults('fitshow'),
    onData: null,
    onLog: null,

    async attach(server) {
      const svc = await server.getPrimaryService(UUID.fitshowService);
      notifyCh = await svc.getCharacteristic(UUID.fitshowNotify);
      onNotify = (e) => self.onLog?.(`rx ${hex(e.target.value)}`);
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
  const std = btoa(String.fromCharCode(...UTF8.encode(text)));
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
  return UTF8_DECODER.decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
}

// "props CurrentSpeed 1.1 RunningSteps 11" -> {CurrentSpeed:'1.1', RunningSteps:'11'}
function parseProps(line) {
  const parts = line.trim().split(/\s+/);
  if (parts[0] !== 'props') return null;
  const out = {};
  for (let i = 1; i + 1 < parts.length; i += 2) out[parts[i]] = parts[i + 1].replace(/^"|"$/g, '');
  return out;
}

// Anything that is not a finite number is dropped rather than passed on. NaN survives the
// absent-key strip below (it is not `== null`), and once it reaches `live` the belt is
// neither moving nor stopped — isMoving is false and confirmedStopped is false — so both
// confirmation watchers run out their deadlines and the readout says NaN.
const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** num() over a thousandth-unit field. Null-safe on purpose: `null / 1000` is 0, which
 *  would turn an absent field into a real zero and blank the merged value. */
const milli = (v) => {
  const n = num(v);
  return n == null ? null : n / 1000;
};

/**
 * A stable, meaningless id for the `props user_id` slot in the handshake.
 *
 * Kept in localStorage so one browser looks like one client across sessions — some pads
 * key their own session bookkeeping off it — while carrying no connection to any real
 * KS+Fit account. Falls back to a per-connection value when storage is unavailable
 * (private mode, quota); nothing depends on it persisting.
 */
const INSTALL_ID_KEY = 'wp.installId.v1';

export function installId() {
  const fresh = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  try {
    const saved = localStorage.getItem(INSTALL_ID_KEY);
    if (saved && /^\d+$/.test(saved)) return saved;
    const id = fresh();
    localStorage.setItem(INSTALL_ID_KEY, id);
    return id;
  } catch {
    return fresh();
  }
}

/** Ceiling on the line-reassembly buffer — see `_rx`. */
const KS_RX_MAX = 4096;

// The text protocol's entire byte repertoire: the permuted-base64 alphabet, its '='
// padding, and the CR terminator. Nothing else can appear in a ksBase64 line — which is
// what makes the pad's other traffic on the same characteristic recognisable.
//
// That other traffic is real: fed8 also carries short raw binary frames, interleaved
// with the text. In the play–pause capture the pad pushed `1f 04 08 03 05 00` right
// after a pause — a time-sync request KS+Fit answers on a third characteristic — and
// acked the answer with `13 05 fa 5f 65 0a 00`. See "Binary sidecar" in
// docs/protocols.md.
const KS_TEXT_BYTES = new Uint8Array(256);
for (const c of KS_B64 + '=\r') KS_TEXT_BYTES[c.charCodeAt(0)] = 1;
const isKsTextByte = (b) => KS_TEXT_BYTES[b] === 1;

/**
 * The band this protocol's parent spec — Xiaomi's MIoT serial command set — reserves for
 * errors the device vendor defines itself: -9999 to -5000 inclusive. Everything above it
 * (-4001 to -4007) is MIoT's own fixed list, and none of those mean "refused".
 *
 * A KS-C2 that will not honour a start answers `props Error ErrorCode -5000` within the
 * same second. What -5000 means is KingSmith firmware's business and is written down
 * nowhere public, so the whole band is treated as one thing — the pad saying no — rather
 * than pinning the reading on a single number that a sibling model may not share.
 */
const KS_VENDOR_ERROR_MAX = -5000;
const KS_VENDOR_ERROR_MIN = -9999;

/** How long to give the pad to answer a start before giving up on hearing either way. On
 *  a real KS-C2 both the refusal and the acceptance land inside one second. */
const KS_START_VERDICT_MS = 1500;

export function ks1234Driver() {
  let writeCh = null;
  let notifyCh = null;
  let onNotify = null;
  let rxBuf = '';
  let closed = false;
  const queue = serialiser();

  // Firmware identity arrives in two different replies — `version` answers with the
  // network module's build, the config dump carries `mcu_version` — so it is assembled
  // here and published as one field. Worth the bookkeeping: when a sibling model
  // misbehaves, "which firmware" is the first question a bug report has to answer.
  let fwMcu = null;
  let fwModule = null;
  function noteFirmware({ mcu, module: mod }) {
    fwMcu = mcu ?? fwMcu;
    fwModule = mod ?? fwModule;
    const parts = [];
    if (fwMcu != null) parts.push(`MCU ${fwMcu}`);
    if (fwModule != null) parts.push(`module ${fwModule}`);
    const label = parts.join(', ');
    if (label && label !== self.firmware) {
      self.firmware = label;
      self.onLog?.(`pad firmware: ${label}`);
    }
  }

  /** The pad's answer to the most recent `start()`; null before the first one. */
  let lastStart = null;

  /**
   * Open a window for the pad to answer the start that is about to be written.
   *
   * Armed *before* the write rather than after it, because the refusal comes back inside
   * the same second and a listener installed afterwards races it.
   */
  function armStartVerdict() {
    lastStart?.settle('unknown'); // a new start supersedes the old one's window
    let resolve;
    const answer = new Promise((r) => {
      resolve = r;
    });
    const record = {
      answer,
      open: true,
      timer: null,
      settle(verdict) {
        if (!record.open) return;
        record.open = false;
        if (record.timer != null) clearTimeout(record.timer);
        record.timer = null;
        resolve(verdict);
      },
    };
    lastStart = record;
    return record;
  }

  const self = {
    id: 'ks1234',
    name: 'KingSmith 0x1234 (chip:3)',
    ...protocolDefaults('ks1234'),
    onData: null,
    onLog: null,
    /** Firmware identity as the pad reports it, e.g. "MCU 0005, module 0014". */
    firmware: null,
    /** The pad's own child-lock switch: true is engaged, null until the pad has said.
     *  Surfaced because KS+Fit's own advice for a refused start points at the lock
     *  first — see `watchForStart` in state/connection.ts. */
    childLockOn: null,

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
      // Nothing is going to answer now, and a caller awaiting the verdict of a start that
      // was in flight when the link went should not be left holding an unsettled promise.
      lastStart?.settle('unknown');
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
    // Queued as a unit: a message interleaved with another one's fragments is undecodable,
    // because the pad reassembles a single stream on CR.
    _send(text) {
      return queue(async () => {
        if (closed || !writeCh) return;
        self.onLog?.(`--> ${text}`);
        const frame = UTF8.encode(ksEncode(text) + '\r');
        for (let i = 0; i < frame.length; i += 20) {
          // Re-checked every fragment, not just once on the way in: detach() nulls the
          // characteristic between two of them, and the write below would then fail as
          // an opaque TypeError — during the connect handshake, out of attach(). Half a
          // message is nothing the pad can use, so stopping here loses nothing.
          if (closed || !writeCh) return;
          await writeChar(writeCh, frame.slice(i, i + 20));
          await sleep(30);
        }
        await sleep(60);
      });
    },

    async _handshake() {
      const posix = Math.floor(Date.now() / 1000);
      await self._send('shake');
      await self._send(`time_posix ${posix}`);
      await self._send('version');
      // Property id list the app asks for on connect — device config and limits.
      await self._send('servers getProp 1 3 7 8 9 16 17 18 19 21 22 23 24 13 15');
      // The pad accepts any integer here and the app never reads it back, so this is
      // not an identity the protocol checks. The value in the original capture was the
      // KS+Fit account id of whoever's phone was being recorded, and shipping someone
      // else's account number to every pad this app touches is nobody's intent —
      // least of all if a unit ever relays it to the vendor's cloud. Per-install and
      // random instead, so it is stable for one browser and means nothing anywhere else.
      await self._send(`props user_id ${installId()}`);
      await self._send('get_pk');
      // ControlMode 1 hands control to the app (2 = the pad's own panel).
      await self._send('props ControlMode 1');
      // Subscribe to the live telemetry set.
      await self._send('servers getProp 1 9 15 2 10 11 12 13 14');
      self.onLog?.('handshake complete');
    },

    // _send returns quietly when the link is gone, which is right for the handshake —
    // a teardown mid-handshake is not an error. It is wrong for a command: doStop()
    // treats a resolved stop() as the belt having been told to stop, so a silent no-op
    // reports a stop that was never sent. Commands say so instead.
    _requireOpen() {
      if (closed || !writeCh) throw new Error(NOT_CONNECTED);
    },

    // async, so a refusal arrives as a rejected promise like every other failure on this
    // interface rather than as a synchronous throw past a caller's .catch().
    async start() {
      self._requireOpen();
      const verdict = armStartVerdict();
      try {
        // Stopping hands control back to the pad's own panel, and in panel mode `runState 1`
        // is accepted and ignored — the belt simply does not move. The connect handshake sets
        // ControlMode 1, which is why the first start of a session worked and no later one
        // did. Re-assert it every time; it is a no-op when the app already holds control.
        //
        // Deliberately still written back-to-back, with no wait for the pad to acknowledge
        // the mode before the run state goes out: that is the exact order and pacing the
        // capture shows KS+Fit using on a start that worked. The acknowledgement is read
        // afterwards, by `startVerdict`, so nothing about what goes on the wire changes.
        await self._send('props ControlMode 1');
        await self._send('props runState 1');
      } catch (e) {
        verdict.settle('unknown');
        throw e;
      }
      // The clock runs from the moment the writes are actually out, not from the call.
      verdict.timer = setTimeout(() => verdict.settle('unknown'), KS_START_VERDICT_MS);
    },

    /**
     * What the pad said about the last start.
     *
     * `'refused'` is the pad answering no — either a vendor error code, or its own panel
     * still reported as holding control, which per the note in `start()` means the run
     * state was accepted and ignored. `'accepted'` is the mode echo coming back. Silence
     * is `'unknown'`, which is the only honest reading of a pad that says nothing: the
     * caller waits for movement, exactly as it does on every other protocol.
     *
     * A verdict is not a claim about the belt — only about whether the command was taken.
     * Movement is still confirmed the one way it can be, by the belt reporting it.
     */
    async startVerdict() {
      return lastStart ? lastStart.answer : 'unknown';
    },
    async stop() {
      self._requireOpen();
      await self._send('props runState 0');
    },
    async setSpeed(kmh) {
      self._requireOpen();
      await self._send(`props CurrentSpeed ${kmh.toFixed(1)}`);
    },
    async pause() {
      // Captured at last: KS+Fit's pause IS `props runState 0`, byte for byte the stop
      // above — a play–pause–play–pause capture on a real KS-C2 shows nothing else on the
      // wire, and the disassembly agrees (startOrStop can only ever emit 0 or 1). What
      // makes it a pause rather than a stop lives on the pad: the session counters
      // survive it (RunningTotalTime held across the gap in the same capture) and a later
      // `runState 1` picks the walk back up. So this resolves 'paused' unconditionally —
      // there is no rejection path a stop does not also have. See docs/protocols.md.
      self._requireOpen();
      await self._send('props runState 0');
      return 'paused';
    },
    async setMode() {
      throw new Error('this protocol has no mode switch');
    },
    async poll() {
      /* the pad pushes telemetry on its own */
    },

    _rx(view) {
      // A binary sidecar frame is answered by keeping it out of the line buffer. Fed to
      // the buffer, its bytes glue onto the next text line, ksDecode refuses the line,
      // and real telemetry goes down with it — in the capture that ate the pad's
      // `props CurrentSpeed 0.5`. Logged as hex rather than parsed: the framing is
      // opcode/length/payload by the look of it, but two observed frames are not a
      // protocol, and nothing in the app needs what they carry.
      const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
      if (!bytes.every(isKsTextByte)) {
        self.onLog?.(`<-- binary sidecar frame ${hex(bytes)} — ignored`);
        return;
      }
      rxBuf += UTF8_DECODER.decode(view);
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
        self._noteStartVerdict(line);
        self._apply(line);
      }
      // Whatever is left is the start of a line still arriving. A pad talking noise —
      // or one that never sends the CR — must not grow this without bound; the longest
      // line in the capture is comfortably under 200 bytes.
      if (rxBuf.length > KS_RX_MAX) {
        self.onLog?.(`discarding ${rxBuf.length} B of unterminated input from the pad`);
        rxBuf = '';
      }
    },

    /**
     * Read the pad's answer to an outstanding start out of an incoming line.
     *
     * Kept apart from `_apply` because this is the control plane, not telemetry: none of
     * it describes the walk, and none of it belongs in the merged reading the UI shows.
     *
     * Matched on the raw line rather than through `parseProps`, which pairs tokens off two
     * at a time and so cannot read the odd-length `props Error ErrorCode -5000` the pad
     * actually sends. Left that way on purpose — `parseProps` reproduces the captured
     * even-length frames byte for byte and is not worth disturbing for one control line.
     */
    _noteStartVerdict(line) {
      if (!lastStart?.open) return;

      const err = /\bErrorCode\s+(-?\d+)\b/.exec(line);
      const code = err ? Number(err[1]) : null;
      if (code != null && code >= KS_VENDOR_ERROR_MIN && code <= KS_VENDOR_ERROR_MAX) {
        self.onLog?.(`the pad refused the start (error ${code})`);
        lastStart.settle('refused');
        return;
      }

      const mode = /\bControlMode\s+(\d+)\b/.exec(line);
      if (!mode) return;
      if (Number(mode[1]) === 2) {
        self.onLog?.('the pad kept control on its own panel — the start will be ignored');
        lastStart.settle('refused');
      } else if (Number(mode[1]) === 1) {
        lastStart.settle('accepted');
      }
    },

    _apply(line) {
      // `version 0014` is the version command's reply — module firmware, not a props line.
      const ver = /^version\s+(\S+)$/.exec(line.trim());
      if (ver) noteFirmware({ module: ver[1] });

      const p = parseProps(line);
      if (!p) return;

      if (p.mcu_version != null) noteFirmware({ mcu: p.mcu_version });

      // Device state rather than telemetry, so it lives on the driver, not in `live`.
      if (p.ChildLockSwitch != null) {
        const on = Number(p.ChildLockSwitch) === 1;
        if (on && self.childLockOn !== true) {
          self.onLog?.('the pad reports its child lock is ON — starts are likely to be refused');
        }
        self.childLockOn = on;
      }

      if (p.StartSpeed != null || p.Max != null) {
        adoptSpeedLimits(
          self,
          {
            ...(p.StartSpeed != null ? { min: Number(p.StartSpeed) } : {}),
            ...(p.Max != null ? { max: Number(p.Max) } : {}),
          },
          self.onLog
        );
      }

      const state = p.runState != null ? Number(p.runState) : null;
      const out = {
        speedKmh: num(p.CurrentSpeed),
        secs: num(p.RunningTotalTime),
        steps: num(p.RunningSteps),
        // Both are metric-milli units: RunningDistance counts metres and BurnCalories
        // counts gram-calories, so each is a thousandth of the unit the app carries.
        // Established from a capture long enough for them to move — see
        // docs/protocols.md, "Distance and calorie scaling".
        distKm: milli(p.RunningDistance),
        kcal: milli(p.BurnCalories),
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

/** 16-bit alias to the full form the GATT table reports, so the two can be compared. */
const canonicalUuid = (u) =>
  typeof u === 'number'
    ? `${u.toString(16).padStart(8, '0')}-0000-1000-8000-00805f9b34fb`
    : String(u).toLowerCase();

export async function detectDriver(server) {
  const candidates = [
    [UUID.classicService, classicDriver],
    [UUID.ftmsService, ftmsDriver],
    [UUID.ks1234Service, ks1234Driver],
    [UUID.fitshowService, fitshowDriver],
  ];

  // Read the table once and match against it. Probing each candidate in turn costs up to
  // four GATT round trips on the connect path, and every miss logs an error of its own.
  try {
    const present = new Set(
      (await server.getPrimaryServices()).map((s) => canonicalUuid(s.uuid))
    );
    for (const [uuid, factory] of candidates) {
      if (present.has(canonicalUuid(uuid))) return factory();
    }
  } catch {
    /* not every stack offers it — fall through and probe */
  }

  // Reached when the stack has no getPrimaryServices, or when nothing matched by name.
  // Comparing UUID strings is a shortcut, so it is only allowed to save work, never to
  // be the reason a pad goes unrecognised: ask the device directly before giving up.
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
