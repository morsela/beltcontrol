import { useState } from 'preact/hooks';
import type { Sample } from '../state/session.js';
import { fmtSpeed, speedUnit, toSpeed, fromSpeed } from '../lib/format.js';
import { units } from '../state/settings.js';

/**
 * Speed across one session. A single series, so no legend box — the title names it.
 * Crosshair plus tooltip on hover, per the interaction default for line/area.
 */
export function AreaChart({
  samples,
  width = 320,
  height = 120,
}: {
  samples: Sample[];
  /** viewBox width — see the note on ColumnChart. */
  width?: number;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);

  if (samples.length < 2) {
    return <p class="note">Not enough samples yet — the chart fills in as you walk.</p>;
  }

  const W = width;
  const H = height;
  const padB = 16;
  const padT = 8;
  // Room for the scale on the left — see the note in ColumnChart.
  const padL = 24;
  const plot = H - padB - padT;

  // Scaled in km/h whatever is shown: the shape of the trace is the same in any unit.
  // The scale beside it is in the unit on screen, so its top is a whole number of
  // *those* — whole mph or whole km/h — converted back to place it.
  const u = units.value;
  const peakShown = toSpeed(Math.max(...samples.map((s) => s.kmh), 1.6), u);
  const topShown = Math.max(1, Math.ceil(peakShown));
  const maxKmh = fromSpeed(topShown, u);
  const tickStep = topShown > 4 ? 2 : 1;
  const ticks: number[] = [];
  for (let v = tickStep; v <= topShown; v += tickStep) ticks.push(v);
  const tMax = samples[samples.length - 1]!.t || 1;

  const x = (t: number) => padL + (t / tMax) * (W - padL);
  const y = (kmh: number) => padT + plot - (kmh / maxKmh) * plot;

  const line = samples.map((s) => `${x(s.t).toFixed(1)},${y(s.kmh).toFixed(1)}`).join(' L');
  const area = `M${padL},${padT + plot} L${line} L${W},${padT + plot} Z`;

  const hoverSample = hover != null ? samples[hover] : null;

  const pick = (e: PointerEvent) => {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const rel = ((px - padL) / (W - padL)) * tMax;
    let best = 0;
    let bestD = Infinity;
    samples.forEach((s, i) => {
      const d = Math.abs(s.t - rel);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    setHover(best);
  };

  return (
    <div class="chart-wrap">
      <svg
        class="chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Speed over the course of this session, in ${speedUnit(units.value)}`}
        onPointerMove={pick}
        onPointerDown={pick}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.28" />
            <stop offset="100%" stop-color="var(--accent)" stop-opacity="0.02" />
          </linearGradient>
        </defs>

        {ticks.map((v) => (
          <g key={v}>
            <line class="grid" x1={padL} x2={W} y1={y(fromSpeed(v, u))} y2={y(fromSpeed(v, u))} />
            <text class="axis-text" x={padL - 5} y={y(fromSpeed(v, u)) + 4} text-anchor="end">
              {v}
            </text>
          </g>
        ))}

        <path d={area} fill="url(#areaFill)" />
        <path d={`M${line}`} fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" />

        {hoverSample && (
          <>
            <line
              class="crosshair"
              x1={x(hoverSample.t)}
              x2={x(hoverSample.t)}
              y1={padT}
              y2={padT + plot}
            />
            <circle
              cx={x(hoverSample.t)}
              cy={y(hoverSample.kmh)}
              r="4"
              fill="var(--accent)"
              stroke="var(--panel)"
              stroke-width="2"
            />
          </>
        )}

        <line class="axis" x1={padL} x2={W} y1={padT + plot} y2={padT + plot} />
        <text class="axis-text" x={padL} y={H - 3}>
          start
        </text>
        <text class="axis-text" x={W} y={H - 3} text-anchor="end">
          {tMax < 60_000 ? `${Math.round(tMax / 1000)}s` : `${Math.round(tMax / 60000)} min`}
        </text>
      </svg>

      {hoverSample && (
        <div
          class="chart-tip"
          style={`left:${(x(hoverSample.t) / W) * 100}%; top:-2px`}
        >
          {fmtSpeed(hoverSample.kmh, units.value)} {speedUnit(units.value)} · {Math.round(hoverSample.t / 60000)} min
        </div>
      )}
    </div>
  );
}
