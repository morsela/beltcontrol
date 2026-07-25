// A fake pad, for development only.
//
// Web Bluetooth cannot be exercised without hardware in reach, which makes the whole
// UI — session detection, counter-reset handling, the charts — untestable on a laptop.
// This driver implements the same interface as the real ones and is only reachable
// when import.meta.env.DEV is true, so it is tree-shaken out of a production build.

import type { Driver, DriverId, Telemetry } from './drivers.js';

export function simulatedDriver(opts: { id?: DriverId; rejectPause?: boolean } = {}): Driver {
  const id: DriverId = opts.id ?? 'classic';
  const rejectPause = opts.rejectPause ?? false;

  let timer: number | null = null;
  let target = 0;
  let speed = 0;
  let secs = 0;
  let distKm = 0;
  let steps = 0;
  let kcal = 0;

  const caps: Record<DriverId, Driver['capabilities']> = {
    classic: { speed: true, mode: true, incline: false, steps: true, pause: false, needsPolling: true },
    ftms: { speed: true, mode: false, incline: false, steps: false, pause: true, needsPolling: false },
    ks1234: { speed: true, mode: false, incline: false, steps: true, pause: false, needsPolling: false },
    fitshow: { speed: false, mode: false, incline: false, steps: false, pause: false, needsPolling: false },
  };

  const self: Driver = {
    id,
    name: `SIMULATED (${id})`,
    capabilities: caps[id],
    maxSpeedKmh: 6,
    minSpeedKmh: 1.0,
    speedStep: 0.1,
    onData: null,
    onLog: null,

    async attach() {
      self.onLog?.('simulator attached — no real device is connected');
      timer = window.setInterval(tick, 1000);
    },
    async detach() {
      if (timer != null) window.clearInterval(timer);
      timer = null;
    },
    async start() {
      self.onLog?.('simulator: start');
      target = Math.max(target, 1.0);
    },
    async stop() {
      self.onLog?.('simulator: stop');
      target = 0;
    },
    async pause() {
      if (!caps[id].pause) throw new Error(`the simulated ${id} protocol has no pause command`);
      self.onLog?.('simulator: pause');
      target = 0;
      // A real unit may still answer "op code not supported"; connectSimulated('ftms',
      // { rejectPause: true }) plays that back so the fallback is reachable in dev too.
      return rejectPause ? 'stopped' : 'paused';
    },
    async setSpeed(kmh: number) {
      target = kmh;
    },
    async setMode(mode: number) {
      self.onLog?.(`simulator: mode ${mode}`);
    },
    async poll() {
      /* the timer already pushes data */
    },
  };

  function tick() {
    // Ramp toward the setpoint rather than snapping, so the "now" readout and the
    // ramping state in the speed control actually get exercised.
    //
    // Slowing is much quicker than speeding up, as it is on a real belt. That asymmetry
    // matters now that a stop or a pause is only reported once the belt says zero: at the
    // old symmetric 0.35 km/h per second, the brisk preset took fourteen seconds to coast
    // down and the simulator failed a confirmation deadline real hardware passes easily.
    const delta = target - speed;
    const rate = delta > 0 ? 0.35 : 2;
    speed += Math.sign(delta) * Math.min(Math.abs(delta), rate);
    if (Math.abs(target - speed) < 0.05) speed = target;

    if (speed > 0) {
      secs += 1;
      distKm += speed / 3600;
      // ~1350 steps per km, the usual figure for a walking stride. Accumulated as a
      // float and rounded on the way out, so a slow belt still advances the counter.
      steps += (speed / 3600) * 1350;
      kcal += speed * 0.012;
    }

    const patch: Partial<Telemetry> = {
      speedKmh: Number(speed.toFixed(2)),
      secs,
      state: speed > 0 ? 2 : 5,
      stateLabel: speed > 0 ? 'running' : 'stopped',
    };
    if (caps[id].steps) patch.steps = Math.round(steps);
    if (id !== 'fitshow') patch.distKm = Number(distKm.toFixed(3));
    if (id === 'ftms' || id === 'ks1234') patch.kcal = Math.round(kcal);

    self.onData?.(patch);
  }

  return self;
}
