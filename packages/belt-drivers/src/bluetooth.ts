// Choosing a device, before any driver exists.
//
// Both lists below are protocol knowledge — which services the drivers reach for, and
// what the pads that speak them are called on the air — so they belong beside the
// drivers rather than in whatever app is doing the asking. They lived in the app's
// connection layer until this package existed, which meant a fifth protocol would have
// been added here and forgotten there, and the symptom would have been a pad the
// chooser never offered.

import { UUID } from './drivers.js';

/**
 * Coarse advertised-name prefixes, covering all 114 treadmill and walking-pad
 * `leach_word` values in the KS+Fit product catalog (assets/mine/allProducts.json).
 *
 * The KingSmith and WalkingPad marks appear here because they are what the hardware
 * calls itself over the air; there is no way to offer the user their own pad without
 * matching the name it advertises.
 */
export const NAME_PREFIXES = [
  'KS-',
  'KingSmith',
  'WalkingPad',
  'R1 Pro',
  'RE',
  'RH',
  'FS-',
  'FT216',
  'Gymnas',
  'ZP-',
];

/** Every service a driver may touch. Web Bluetooth blocks access to any service not
 *  declared up front, so this has to name them all before detection has picked one. */
export const OPTIONAL_SERVICES = [
  UUID.classicService,
  UUID.ftmsService,
  UUID.ks1234Service,
  UUID.fitshowService,
  UUID.deviceInfo,
  UUID.battery,
];

/**
 * Options for `navigator.bluetooth.requestDevice`, in the three shapes a caller needs.
 *
 *   name        offer exactly one pad, by the name it gave last time
 *   filtered    offer the pads whose names this project recognises (the default)
 *   neither     offer everything, for a pad whose name is not in the catalog
 *
 * The unfiltered form exists because the catalog is a snapshot: a pad that speaks one
 * of these protocols under a name nobody has seen yet still works once it is picked.
 */
export function requestOptions({
  name,
  filtered = true,
}: { name?: string | null; filtered?: boolean } = {}): RequestDeviceOptions {
  if (name) return { filters: [{ name }], optionalServices: OPTIONAL_SERVICES };
  if (filtered) {
    return {
      filters: NAME_PREFIXES.map((namePrefix) => ({ namePrefix })),
      optionalServices: OPTIONAL_SERVICES,
    };
  }
  return { acceptAllDevices: true, optionalServices: OPTIONAL_SERVICES };
}
