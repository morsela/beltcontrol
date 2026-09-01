import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { connect, disconnect, connected, phase } from '../src/state/connection.js';
import { settings, updateSettings } from '../src/state/settings.js';
import { UUID } from '../src/lib/drivers.js';
import { FakeServer, FakeCharacteristic } from './ble-mock.js';

/**
 * The chooser side of `connect()`: what it asks the browser for, and what it keeps
 * afterwards. The remembered name drives the Reconnect button on the first page, so
 * the properties under test are exactly the ones that button's honesty rests on —
 * a name is only stored once a pad has been driven end to end, and reconnecting asks
 * for that pad and nothing else.
 */

/** A device whose GATT table speaks classic fe00, so detection and attach succeed. */
function fakeDevice(name?: string) {
  const server = new FakeServer().addService(UUID.classicService, [
    new FakeCharacteristic(UUID.classicNotify),
    new FakeCharacteristic(UUID.classicWrite),
  ]);
  return {
    name,
    id: 'fake-device-id',
    gatt: {
      connected: true,
      connect: async () => server,
      disconnect: () => {},
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as BluetoothDevice;
}

/** A device that connects but speaks nothing the app knows, so `detectDriver` returns
 *  null and the connect path fails after the GATT link is already up. */
function unknownDevice() {
  const server = new FakeServer().addService(UUID.deviceInfo, [
    new FakeCharacteristic(0x2a29),
  ]);
  const disconnect = vi.fn();
  const device = {
    name: 'Some Speaker',
    id: 'unknown-device-id',
    gatt: {
      connected: true,
      connect: async () => server,
      disconnect,
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  } as unknown as BluetoothDevice;
  return { device, disconnect };
}

function installBluetooth(requestDevice: (o: RequestDeviceOptions) => Promise<BluetoothDevice>) {
  const mock = vi.fn(requestDevice);
  Object.defineProperty(navigator, 'bluetooth', {
    value: { requestDevice: mock },
    configurable: true,
  });
  return mock;
}

/** The options of the one request made, narrowed to the filtered form of the union. */
function requestedOptions(mock: ReturnType<typeof installBluetooth>) {
  const options = mock.mock.calls[0]?.[0];
  if (!options || !('filters' in options)) throw new Error('expected a filtered request');
  return options;
}

beforeEach(() => {
  updateSettings({ lastDeviceName: null });
});

afterEach(async () => {
  await disconnect();
  Reflect.deleteProperty(navigator, 'bluetooth');
});

/**
 * A connect that fails after `gatt.connect()` has landed still holds the link. Nothing
 * downstream releases it: `teardown` unwinds the driver, and on this path there is no
 * driver — detection is what failed. Left open, the pad stays bound to this tab for as
 * long as it lives, and the vendor's own app cannot reach it in the meantime.
 */
describe('a connect that fails after the link is up', () => {
  it('hands the pad back rather than holding it', async () => {
    const { device, disconnect: gattDisconnect } = unknownDevice();
    installBluetooth(async () => device);

    await connect({ filtered: true });

    expect(phase.value).toBe('error');
    expect(gattDisconnect).toHaveBeenCalled();
  });

  it('does not remember a pad it could not drive', async () => {
    const { device } = unknownDevice();
    installBluetooth(async () => device);

    await connect({ filtered: true });

    expect(settings.value.lastDeviceName).toBe(null);
  });
});

describe('connect', () => {
  it('remembers the advertised name once the whole handshake has succeeded', async () => {
    installBluetooth(async () => fakeDevice('KS-ST-A1P'));

    await connect({ filtered: true });

    expect(connected.value).toBe(true);
    expect(settings.value.lastDeviceName).toBe('KS-ST-A1P');
  });

  it('does not remember a device that failed protocol detection', async () => {
    // A pad the app cannot drive must never be the pad Reconnect offers back.
    updateSettings({ lastDeviceName: 'KS-ST-A1P' });
    const unknown = {
      ...fakeDevice('Mystery-Pad'),
      gatt: {
        connected: true,
        connect: async () => new FakeServer(), // no known treadmill service
        disconnect: () => {},
      },
    } as unknown as BluetoothDevice;
    installBluetooth(async () => unknown);

    await connect({ filtered: true });

    expect(connected.value).toBe(false);
    expect(settings.value.lastDeviceName).toBe('KS-ST-A1P');
  });

  it('leaves the remembered name alone when the chooser is cancelled', async () => {
    updateSettings({ lastDeviceName: 'KS-ST-A1P' });
    installBluetooth(async () => {
      throw new DOMException('cancelled', 'NotFoundError');
    });

    await connect({ filtered: true });

    expect(phase.value).toBe('idle');
    expect(settings.value.lastDeviceName).toBe('KS-ST-A1P');
  });

  it('narrows the chooser to exactly the remembered name on reconnect', async () => {
    const request = installBluetooth(async () => fakeDevice('KS-ST-A1P'));

    await connect({ filtered: true, name: 'KS-ST-A1P' });

    expect(request).toHaveBeenCalledOnce();
    const options = requestedOptions(request);
    expect(options.filters).toEqual([{ name: 'KS-ST-A1P' }]);
    expect('acceptAllDevices' in options).toBe(false);
  });

  it('keeps the prefix filters when no name is given', async () => {
    const request = installBluetooth(async () => fakeDevice('KS-ST-A1P'));

    await connect({ filtered: true });

    const options = requestedOptions(request);
    expect(options.filters.length).toBeGreaterThan(1);
    expect(options.filters.every((f) => 'namePrefix' in f)).toBe(true);
  });
});
