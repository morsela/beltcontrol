import { driver, connected } from '../state/connection.js';
import { live, trustFor } from '../state/telemetry.js';
import { currentSession } from '../state/session.js';
import { fmtMph, fmtDuration, fmt, fmtInt, EM_DASH } from '../lib/format.js';

interface Tile {
  k: string;
  v: string;
  /** Scaling never established for this protocol — flagged, and never aggregated. */
  unverified?: boolean;
}

/**
 * At most three support tiles, and only ones this connection can actually fill.
 * A tile that would always read "—" is not rendered at all.
 */
export function Tiles() {
  const d = driver.value;
  const t = live.value;
  const session = currentSession.value;
  const trust = d ? trustFor(d.id) : null;

  const tiles: Tile[] = [];

  // Live speed: every driver that reports anything reports this.
  tiles.push({ k: 'mph now', v: connected.value ? fmtMph(t.speedKmh) : EM_DASH });

  tiles.push({
    k: 'session',
    v: session ? fmtDuration(Math.round(session.activeMs / 1000)) : EM_DASH,
  });

  if (trust && trust.distKm !== 'absent') {
    tiles.push({
      k: 'km',
      v: session ? fmt(session.distKm, 2) : EM_DASH,
      unverified: trust.distKm === 'unverified',
    });
  } else if (trust && trust.steps !== 'absent') {
    tiles.push({
      k: 'steps',
      v: session ? fmtInt(session.steps) : EM_DASH,
      unverified: trust.steps === 'unverified',
    });
  }

  return (
    <div class="tiles" data-n={String(tiles.length)}>
      {tiles.map((tile) => (
        <div class="tile" key={tile.k}>
          <span class="v tnum">
            {tile.v}
            {tile.unverified && (
              <span class="unverified" title="Scaling for this field was never established — shown raw, excluded from totals">
                ?
              </span>
            )}
          </span>
          <span class="k">{tile.k}</span>
        </div>
      ))}
    </div>
  );
}
