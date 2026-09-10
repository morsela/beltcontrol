// The SDK's front door: the four protocol drivers, what they report, and the detection
// that picks between them.
//
// The simulator is deliberately not re-exported here. It is a fifth driver for running
// the UI without hardware, and the app reaches it with a dynamic import so it lands in
// a chunk of its own — a re-export from this barrel would pull it back into the main
// bundle of anything that imports the SDK at all. Same for the GATT fake behind
// `/testing`, which no shipping build should be able to reach.
//
//   import { detectDriver } from '@beltcontrol/belt-drivers';
//   import { simulatedDriver } from '@beltcontrol/belt-drivers/simulator';
//   import { FakeServer } from '@beltcontrol/belt-drivers/testing';

export * from './drivers.js';
export * from './bluetooth.js';
