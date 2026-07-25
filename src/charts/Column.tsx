import { useState } from 'preact/hooks';
import type { DayTotal } from '../state/session.js';

/**
 * Daily minutes over time.
 *
 * Emphasis, not categorical: one hue in two shades. Days that met the goal take the
 * full accent, the rest sit in the dim step, and a dashed rule marks the goal. One
 * y-axis, recessive gridlines, 2px gap between adjacent bars, 4px rounded tops
 * anchored to the baseline.
 */
export function ColumnChart({
  data,
  goalMinutes,
  width = 320,
  height = 140,
}: {
  data: DayTotal[];
  goalMinutes: number;
  /** viewBox width. The SVG scales to its container, so a phone-sized viewBox in a
   *  desktop column magnifies the axis text and the goal dashes along with the bars.
   *  Callers pass roughly the rendered width to keep 1 unit ≈ 1 px. */
  width?: number;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const W = width;
  const H = height;
  const padB = 18;
  const padT = 8;
  const plot = H - padB - padT;

  const max = Math.max(goalMinutes, ...data.map((d) => d.minutes), 1);
  const n = Math.max(data.length, 1);
  const slot = W / n;
  const barW = Math.max(2, slot - 2); // 2px surface gap between adjacent bars
  const r = Math.min(4, barW / 2);

  const y = (v: number) => padT + plot - (v / max) * plot;
  const goalY = y(goalMinutes);
  const hovered = hover != null ? data[hover] : null;

  return (
    <div class="chart-wrap">
      <svg
        class="chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Walking minutes per day for the last ${data.length} days`}
        onPointerLeave={() => setHover(null)}
      >
        {goalMinutes > 0 && goalY > padT && (
          <line class="goal-line" x1="0" x2={W} y1={goalY} y2={goalY} />
        )}

        {data.map((d, i) => {
          const h = Math.max(d.minutes > 0 ? 2 : 0, (d.minutes / max) * plot);
          const x = i * slot + (slot - barW) / 2;
          const met = goalMinutes > 0 && d.minutes >= goalMinutes;
          return (
            <g key={d.key}>
              {/* Hit target spans the whole slot, not just the bar. */}
              <rect
                x={i * slot}
                y={0}
                width={slot}
                height={H}
                fill="transparent"
                onPointerEnter={() => setHover(i)}
              />
              {h > 0 && (
                <rect
                  class={`bar${met ? ' met' : ''}${hover === i ? ' hovered' : ''}`}
                  x={x}
                  y={padT + plot - h}
                  width={barW}
                  height={h}
                  rx={r}
                />
              )}
            </g>
          );
        })}

        <line class="axis" x1="0" x2={W} y1={padT + plot} y2={padT + plot} />
        {data.length > 0 && (
          <>
            <text class="axis-text" x="0" y={H - 4}>
              {label(data[0]!.date)}
            </text>
            <text class="axis-text" x={W} y={H - 4} text-anchor="end">
              {label(data[data.length - 1]!.date)}
            </text>
          </>
        )}
      </svg>

      {hovered && hover != null && (
        <div
          class="chart-tip"
          style={`left:${((hover + 0.5) / n) * 100}%; top:-2px`}
        >
          {label(hovered.date)} · {Math.round(hovered.minutes)} min
        </div>
      )}
    </div>
  );
}

const label = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
