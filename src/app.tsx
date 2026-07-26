import { useEffect, useErrorBoundary, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { Analytics } from '@vercel/analytics/react';
import { Now } from './routes/Now.js';
import { Today } from './routes/Today.js';
import { History } from './routes/History.js';
import { Legal } from './routes/Legal.js';
import { TabBar } from './components/TabBar.js';
import { StopBar } from './components/StopBar.js';
import { AmbientView } from './components/AmbientView.js';
import { DesktopOnlyNotice } from './components/DesktopOnlyNotice.js';
import { Recovery } from './components/Recovery.js';
import { Disclaimer } from './components/Disclaimer.js';
import { beltMayBeMoving, connected } from './state/connection.js';
import { isDesktop } from './lib/viewport.js';
import { trackEvent } from './lib/analytics.js';

export type Route = 'now' | 'today' | 'history' | 'legal';

/** Every hash the router will accept. `legal` is reachable but is not a tab — see TabBar. */
const ROUTES: Route[] = ['now', 'today', 'history', 'legal'];

/** Hash routing in a dozen lines — a router dependency would outweigh three screens. */
function readHash(): Route {
  const raw = location.hash.replace(/^#\/?/, '');
  return (ROUTES as string[]).includes(raw) ? (raw as Route) : 'now';
}

export const route = signal<Route>(readHash());

window.addEventListener('hashchange', () => {
  route.value = readHash();
  window.scrollTo(0, 0);
  // The landing view is the vendor's ordinary page view; hash navigation is not,
  // so tab switches would otherwise be invisible.
  trackEvent('route_viewed', { route: route.value });
});

export function App() {
  const [ambient, setAmbient] = useState(false);
  // Stored history is read on every render path, so a throw over bad data repeats on
  // every load. Without a boundary that is a permanently blank page and no way back.
  const [error, resetError] = useErrorBoundary();
  const contentRef = useRef<HTMLDivElement>(null);
  const r = route.value;
  const desktop = isDesktop.value;

  if (error) return <Recovery error={error} onRetry={resetError} />;

  const enterAmbient = () => {
    trackEvent('ambient_entered');
    setAmbient(true);
  };

  // Ambient mode is only meaningful while something is actually connected.
  useEffect(() => {
    if (ambient && !connected.value) setAmbient(false);
  }, [ambient, connected.value]);

  // On desktop `now` stops being a destination and becomes the rail, so the URL is
  // rewritten rather than left pointing at a page with no nav entry — a nav where
  // nothing is current cannot tell you where you are. `replace`, not `assign`, so
  // Back does not bounce through it.
  useEffect(() => {
    if (desktop && r === 'now') location.replace('#/today');
  }, [desktop, r]);

  if (ambient) return <AmbientView onExit={() => setAmbient(false)} />;

  const showStop = beltMayBeMoving.value;

  if (desktop) {
    return (
      <>
        <TabBar route={r} variant="top" />

        {/* The rail sits between the nav and the content in DOM order, which is
            correct for reading and long for tabbing. Not a link: an href would put
            a fragment in the hash and the router reads the hash. */}
        <button class="skip" onClick={() => contentRef.current?.focus()}>
          Skip to content
        </button>

        <main class="shell shell-desktop">
          <aside class="rail" aria-label="Belt controls">
            {showStop && <StopBar />}
            <Now onAmbient={enterAmbient} />
          </aside>

          <div class="content" tabIndex={-1} ref={contentRef}>
            <DesktopOnlyNotice />
            {r === 'legal' ? <Legal /> : r === 'history' ? <History /> : <Today />}
            {/* The footer disclaimer is a pointer at the legal page. On the legal page
                itself it would be the same statement twice on one screen. */}
            {r !== 'legal' && <Disclaimer />}
          </div>
        </main>
        <Analytics />
      </>
    );
  }

  return (
    <>
      <main class={`shell${showStop ? ' has-stopbar' : ''}`}>
        <DesktopOnlyNotice />
        {r === 'now' && <Now onAmbient={enterAmbient} />}
        {r === 'today' && <Today />}
        {r === 'history' && <History />}
        {r === 'legal' && <Legal />}
        {r !== 'legal' && <Disclaimer />}
      </main>

      {showStop && <StopBar />}
      <TabBar route={r} />
      <Analytics />
    </>
  );
}
