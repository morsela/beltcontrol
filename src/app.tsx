import { useEffect, useRef, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { Analytics } from '@vercel/analytics/react';
import { Now } from './routes/Now.js';
import { Today } from './routes/Today.js';
import { History } from './routes/History.js';
import { TabBar } from './components/TabBar.js';
import { StopBar } from './components/StopBar.js';
import { AmbientView } from './components/AmbientView.js';
import { DesktopOnlyNotice } from './components/DesktopOnlyNotice.js';
import { Disclaimer } from './components/Disclaimer.js';
import { isMoving } from './state/telemetry.js';
import { connected } from './state/connection.js';
import { isDesktop } from './lib/viewport.js';

export type Route = 'now' | 'today' | 'history';

const ROUTES: Route[] = ['now', 'today', 'history'];

/** Hash routing in a dozen lines — a router dependency would outweigh three screens. */
function readHash(): Route {
  const raw = location.hash.replace(/^#\/?/, '');
  return (ROUTES as string[]).includes(raw) ? (raw as Route) : 'now';
}

export const route = signal<Route>(readHash());

window.addEventListener('hashchange', () => {
  route.value = readHash();
  window.scrollTo(0, 0);
});

export function App() {
  const [ambient, setAmbient] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const r = route.value;
  const desktop = isDesktop.value;

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

  const showStop = connected.value && isMoving.value;

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
            <Now onAmbient={() => setAmbient(true)} />
          </aside>

          <div class="content" tabIndex={-1} ref={contentRef}>
            <DesktopOnlyNotice />
            {r === 'history' ? <History /> : <Today />}
            <Disclaimer />
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
        {r === 'now' && <Now onAmbient={() => setAmbient(true)} />}
        {r === 'today' && <Today />}
        {r === 'history' && <History />}
        <Disclaimer />
      </main>

      {showStop && <StopBar />}
      <TabBar route={r} />
      <Analytics />
    </>
  );
}
