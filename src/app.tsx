import { useEffect, useErrorBoundary, useState } from 'preact/hooks';
import { signal } from '@preact/signals';
import { Analytics } from '@vercel/analytics/react';
import { Now } from './routes/Now.js';
import { Today } from './routes/Today.js';
import { History } from './routes/History.js';
import { TabBar } from './components/TabBar.js';
import { StopBar } from './components/StopBar.js';
import { AmbientView } from './components/AmbientView.js';
import { DesktopOnlyNotice } from './components/DesktopOnlyNotice.js';
import { Recovery } from './components/Recovery.js';
import { Disclaimer } from './components/Disclaimer.js';
import { isMoving } from './state/telemetry.js';
import { connected } from './state/connection.js';

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
  // Stored history is read on every render path, so a throw over bad data repeats on
  // every load. Without a boundary that is a permanently blank page and no way back.
  const [error, resetError] = useErrorBoundary();
  const r = route.value;

  if (error) return <Recovery error={error} onRetry={resetError} />;

  // Ambient mode is only meaningful while something is actually connected.
  useEffect(() => {
    if (ambient && !connected.value) setAmbient(false);
  }, [ambient, connected.value]);

  if (ambient) return <AmbientView onExit={() => setAmbient(false)} />;

  const showStop = connected.value && isMoving.value;

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
