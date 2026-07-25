// A minimal fake of the slice of Web Bluetooth the drivers actually touch, so the
// protocol code can be exercised without a treadmill — or a browser — in reach.

export interface CharOpts {
  /** Which write forms the stack advertises. Drivers prefer without-response. */
  properties?: { write?: boolean; writeWithoutResponse?: boolean; notify?: boolean };
  /** Value returned by readValue(); omitted means the characteristic is not readable. */
  value?: number[];
  /** Called after every write — lets a fake pad answer, e.g. an FTMS control-point ack. */
  onWrite?: (bytes: Uint8Array, ch: FakeCharacteristic) => void;
}

type Listener = (e: { target: { value: DataView } }) => void;

export class FakeCharacteristic {
  readonly writes: Uint8Array[] = [];
  notifying = false;
  readonly properties: Required<NonNullable<CharOpts['properties']>>;
  private listeners: Listener[] = [];
  private readonly value: number[] | undefined;
  private readonly onWrite: CharOpts['onWrite'];

  constructor(readonly uuid: string | number, opts: CharOpts = {}) {
    this.properties = {
      write: true,
      writeWithoutResponse: true,
      notify: true,
      ...opts.properties,
    };
    this.value = opts.value;
    this.onWrite = opts.onWrite;
  }

  private record(data: Uint8Array) {
    const copy = new Uint8Array(data);
    this.writes.push(copy);
    this.onWrite?.(copy, this);
  }

  async writeValueWithoutResponse(data: Uint8Array) {
    if (!this.properties.writeWithoutResponse) throw new Error('not supported');
    this.record(data);
  }

  async writeValue(data: Uint8Array) {
    if (!this.properties.write) throw new Error('not writable');
    this.record(data);
  }

  async readValue(): Promise<DataView> {
    if (!this.value) throw new Error('not readable');
    return new DataView(Uint8Array.from(this.value).buffer);
  }

  addEventListener(_type: string, fn: Listener) {
    this.listeners.push(fn);
  }

  removeEventListener(_type: string, fn: Listener) {
    this.listeners = this.listeners.filter((l) => l !== fn);
  }

  get listenerCount() {
    return this.listeners.length;
  }

  async startNotifications() {
    this.notifying = true;
    return this;
  }

  async stopNotifications() {
    this.notifying = false;
    return this;
  }

  /** Push a notification frame at the driver, the way the pad would. */
  emit(bytes: number[] | Uint8Array) {
    const view = new DataView(Uint8Array.from(bytes).buffer);
    for (const l of [...this.listeners]) l({ target: { value: view } });
  }

  /** Writes so far as space-separated hex — the driver's own log format. */
  hexWrites(): string[] {
    return this.writes.map(toHex);
  }

  /** Writes so far decoded as text — for the line-oriented 0x1234 protocol. */
  textWrites(): string {
    return this.writes.map((w) => new TextDecoder().decode(w)).join('');
  }
}

export const toHex = (b: Uint8Array | number[]) =>
  [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ');

class FakeService {
  constructor(private readonly chars: Map<string | number, FakeCharacteristic>) {}

  async getCharacteristic(uuid: string | number) {
    const c = this.chars.get(uuid);
    if (!c) throw new Error(`no characteristic ${String(uuid)}`);
    return c;
  }
}

export class FakeServer {
  private readonly services = new Map<string | number, FakeService>();

  addService(uuid: string | number, chars: FakeCharacteristic[]) {
    this.services.set(uuid, new FakeService(new Map(chars.map((c) => [c.uuid, c]))));
    return this;
  }

  async getPrimaryService(uuid: string | number) {
    const s = this.services.get(uuid);
    if (!s) throw new Error(`no service ${String(uuid)}`);
    return s;
  }
}
