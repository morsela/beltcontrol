// Screen Wake Lock. Supported in exactly the same Chromium browsers that implement
// Web Bluetooth, so holding it adds no new browser requirement.
//
// The lock is released by the UA whenever the document is hidden, so it has to be
// re-acquired on visibilitychange or the screen sleeps the moment you tab away and
// come back — which, for a tablet propped on a treadmill, is the whole point.

import { signal } from '@preact/signals';

export const wakeLockActive = signal(false);

let sentinel: WakeLockSentinel | null = null;
let wanted = false;

async function acquire() {
  if (!wanted || sentinel || document.visibilityState !== 'visible') return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    wakeLockActive.value = true;
    sentinel.addEventListener('release', () => {
      sentinel = null;
      wakeLockActive.value = false;
    });
  } catch {
    // Denied (low battery, policy). Not fatal — the screen just sleeps.
    wakeLockActive.value = false;
  }
}

export const wakeLockSupported = () => 'wakeLock' in navigator;

export async function requestWakeLock() {
  if (!wakeLockSupported()) return;
  wanted = true;
  await acquire();
}

export async function releaseWakeLock() {
  wanted = false;
  wakeLockActive.value = false;
  try {
    await sentinel?.release();
  } catch {
    /* already gone */
  }
  sentinel = null;
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void acquire();
  });
}
