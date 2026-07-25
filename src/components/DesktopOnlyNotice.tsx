import { signal } from '@preact/signals';
import { isMobile } from '../lib/platform.js';
import { supported } from '../state/connection.js';

const KEY = 'wp.desktopNotice.dismissed.v1';

/** Evaluated once: the device does not change mid-session. `?forcemobile` is the
 *  dev-only way to see this on a desktop, in the spirit of the simulator hook —
 *  `import.meta.env.DEV` is statically false in a production build. */
const onMobile = isMobile() || (import.meta.env.DEV && location.search.includes('forcemobile'));

const dismissed = signal(read());

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

function dismiss() {
  dismissed.value = true;
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* private mode — the notice just comes back next load */
  }
}

/**
 * Tells phone and tablet users up front that this is a desktop app, rather than
 * letting them find out when the device chooser never appears.
 *
 * Dismissible, because a notice that cannot be closed would sit on top of every
 * screen forever for anyone who read it and carried on anyway.
 */
export function DesktopOnlyNotice() {
  if (!onMobile || dismissed.value) return null;

  return (
    <div class="banner" role="status">
      <div class="banner-body">
        <strong>Best on desktop</strong>
        <p>
          Belt Control drives the treadmill over Web Bluetooth, which this app is built and
          tested for on desktop Chrome, Edge or Opera.{' '}
          {supported.value
            ? 'On a phone or tablet, expect a cramped layout and flaky pairing.'
            : 'This browser has no Web Bluetooth at all — Safari on iOS and Firefox never implemented it, so connecting will not work here.'}
        </p>
      </div>
      <button class="btn ghost banner-close" onClick={dismiss} aria-label="Dismiss desktop notice">
        ✕
      </button>
    </div>
  );
}
