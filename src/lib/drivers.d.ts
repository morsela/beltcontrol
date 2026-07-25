// Hand-written types for `drivers.js`.
//
// drivers.js is deliberately left as plain JavaScript: it is the reverse-engineered
// half of this project, it has no DOM dependencies, and rewriting it in TypeScript
// would risk the protocol work for no runtime gain. This file describes it instead.

/** Canonical telemetry. A field the device does not report is `null`, never 0. */
export interface Telemetry {
  speedKmh: number | null;
  distKm: number | null;
  steps: number | null;
  secs: number | null;
  kcal: number | null;
  /** Raw belt-state code straight off the wire. */
  state: number | null;
  /** Best-effort label for `state`; the UI shows the raw number beside it. */
  stateLabel: string | null;
  mode: number | null;
  heartRate: number | null;
  inclinePct: number | null;
  raw?: unknown;
}

export interface Capabilities {
  speed: boolean;
  mode: boolean;
  incline: boolean;
  steps: boolean;
  /** The protocol carries a real pause — a stop the belt can be resumed from, rather
   *  than a full stop dressed up as one. FTMS only, so far. Whether the individual
   *  unit honours it is a separate question, answered by `pause()`'s result. */
  pause: boolean;
  /** Classic pads never push status; the caller must poll on a timer. */
  needsPolling: boolean;
}

export type DriverId = 'classic' | 'ftms' | 'fitshow' | 'ks1234';

export interface Driver {
  readonly id: DriverId;
  readonly name: string;
  readonly capabilities: Capabilities;
  /** Mutable: FTMS and 0x1234 rewrite these from the device after attach(). */
  maxSpeedKmh: number;
  minSpeedKmh: number;
  speedStep: number;

  onData: ((d: Partial<Telemetry>) => void) | null;
  onLog: ((msg: string) => void) | null;

  attach(server: BluetoothRemoteGATTServer): Promise<void>;
  /** Throws if the write channel is gone, so a command can never resolve without
   *  having been sent. Present on the drivers that can write at all. */
  _requireOpen?(): void;
  detach(): Promise<void>;
  /** Also resumes from a pause: FTMS spends one op code on "Start or Resume". */
  start(): Promise<void>;
  stop(): Promise<void>;
  /**
   * Pause the belt, resumable with `start()`.
   *
   * Resolves `'paused'` when the unit honoured it, or `'stopped'` when it did not
   * support pause and the driver stopped the belt instead — never leave a treadmill
   * running behind a button that claims it is paused. Rejects only on a real failure,
   * and on protocols that have no pause command at all.
   */
  pause(): Promise<'paused' | 'stopped'>;
  setSpeed(kmh: number): Promise<void>;
  setMode(mode: number): Promise<void>;
  poll(): Promise<void>;
}

export declare const UUID: {
  classicService: number;
  classicNotify: number;
  classicWrite: number;
  ftmsService: number;
  ftmsTreadmillData: number;
  ftmsControlPoint: number;
  ftmsStatus: number;
  ftmsFeature: number;
  ftmsSpeedRange: number;
  fitshowService: number;
  fitshowNotify: number;
  fitshowWrite: number;
  ks1234Service: number;
  ks1234Write: string;
  ks1234Notify: string;
  deviceInfo: number;
  battery: number;
};

export declare const CLASSIC_MODE: { auto: 0; manual: 1; standby: 2 };

/** The app's own speed envelope, applied on top of whatever a device reports about
 *  itself — see `adoptSpeedLimits`. */
export declare const HARD_MAX_KMH: number;
export declare const HARD_MIN_KMH: number;
export declare const HARD_MAX_STEP_KMH: number;

/**
 * Fold device-reported speed limits into a driver, rejecting any that fall outside the
 * envelope above. A rejected field keeps the driver's conservative default and is
 * reported through `onLog`.
 */
export declare function adoptSpeedLimits<
  T extends Pick<Driver, 'minSpeedKmh' | 'maxSpeedKmh' | 'speedStep'>,
>(
  self: T,
  limits: { min?: number; max?: number; step?: number },
  onLog?: ((msg: string) => void) | null
): T;

export declare function detectDriver(
  server: BluetoothRemoteGATTServer
): Promise<Driver | null>;

export declare function classicDriver(): Driver;
export declare function ftmsDriver(): Driver;
export declare function fitshowDriver(): Driver;
export declare function ks1234Driver(): Driver;

/** Everything a Treadmill Data (0x2ACD) frame can carry. Absent fields are simply
 *  missing — the flags word says which are present, so `undefined` and `null` mean
 *  different things here: not sent, versus sent as the spec's "not available". */
export interface TreadmillData extends Partial<Telemetry> {
  raw: string;
  /** The flags word promised a field the frame did not carry. Fields that were fully
   *  present are still returned; everything after the short read is absent. */
  truncated?: true;
  avgSpeedKmh?: number;
  rampAngleDeg?: number;
  elevGainUpM?: number;
  elevGainDownM?: number;
  paceKmPerMin?: number;
  avgPaceKmPerMin?: number;
  kcalPerHour?: number;
  kcalPerMin?: number;
  mets?: number;
  remainingSecs?: number;
  forceOnBeltN?: number;
  powerW?: number;
}

export declare function parseTreadmillData(view: DataView): TreadmillData;
/** Space-separated hex. A view is formatted as the bytes it covers, not as the whole
 *  buffer behind it. */
export declare function hex(buf: ArrayBuffer | ArrayBufferView | ArrayLike<number>): string;

/** Text in, permuted-base64 text out. The alphabet is a KingSmith permutation of
 *  the standard one, so this is not interchangeable with btoa/atob. */
export declare function ksEncode(text: string): string;
export declare function ksDecode(cipher: string): string;

/** A stable, meaningless id for the handshake's `props user_id` slot — persisted per
 *  browser, unrelated to any real KS+Fit account. */
export declare function installId(): string;

/** `null` when the line is not a `props` line at all. */
export declare function parseProps(line: string): Record<string, string> | null;
