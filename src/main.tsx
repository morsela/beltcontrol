import { render } from 'preact';
import './styles/tokens.css';
import './styles/app.css';
import { App } from './app.js';
import { installGuards } from './state/connection.js';
import { restoreOpenSession, startSessionTracking } from './state/session.js';
import { setAnalyticsProvider } from './lib/analytics.js';
import { vercelAnalytics } from './lib/analytics-vercel.js';

// Installed before anything can emit. Only here: everywhere else goes through the
// vendor-neutral seam in lib/analytics.ts.
setAnalyticsProvider(vercelAnalytics);

installGuards();

// A session may have been in flight when the tab was reloaded; recover it so a walk
// is not silently split in two. Tracking runs even while disconnected so a recovered
// session can still be closed out by the idle rule.
restoreOpenSession();
startSessionTracking();

const root = document.getElementById('app');
if (root) {
  // The static intro in index.html has done its two jobs by now — something on screen
  // before the bundle arrived, and prose in the served document for anything that reads
  // this page without running it. Removed rather than hidden: it repeats what the app is
  // about to say properly, and a duplicate <h1> left in the DOM is a second heading for
  // both a screen reader and a crawler.
  document.getElementById('intro')?.remove();
  render(<App />, root);
}

if (import.meta.env.DEV) {
  // Hook for driving the UI without a treadmill in reach:
  //   __wp.connectSimulated('ftms')   __wp.connectSimulated('ks1234')
  void Promise.all([import('./state/connection.js'), import('./state/session.js')]).then(
    ([conn, sess]) => {
      (window as unknown as Record<string, unknown>).__wp = { ...conn, ...sess };
    }
  );
}

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* offline shell is a bonus, not a requirement */
    });
  });
}
