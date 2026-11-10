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
  // Room on the left for the scale. The chart had none: thirty bars and a dashed line,
  // and the only way to learn what any height meant was to hover one — which a phone
  // cannot do.
  const padL = 26;
  const plot = H - padB - padT;

  const peak = Math.max(goalMinutes, ...data.map((d) => d.minutes), 1);
  // Round the top of the scale up to a whole step, so the labels are round numbers.
  const step = niceStep(peak);
  const max = Math.ceil(peak / step) * step;
  const ticks: number[] = [];
  for (let v = step; v <= max + 1e-9; v += step) ticks.push(v);

  const n = Math.max(data.length, 1);
  const slot = (W - padL) / n;
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
        {ticks.map((v) => (
          <g key={v}>
            <line class="grid" x1={padL} x2={W} y1={y(v)} y2={y(v)} />
            <text class="axis-text" x={padL - 5} y={y(v) + 4} text-anchor="end">
              {v}
            </text>
          </g>
        ))}

        {goalMinutes > 0 && goalY >= padT && (
          <line class="goal-line" x1={padL} x2={W} y1={goalY} y2={goalY} />
        )}

        {data.map((d, i) => {
          const h = Math.max(d.minutes > 0 ? 2 : 0, (d.minutes / max) * plot);
          const x = padL + i * slot + (slot - barW) / 2;
          const met = goalMinutes > 0 && d.minutes >= goalMinutes;
          return (
            <g key={d.key}>
              {/* Hit target spans the whole slot, not just the bar. */}
              <rect
                x={padL + i * slot}
                y={0}
                width={slot}
                height={H}
                fill="transparent"
                onPointerEnter={() => setHover(i)}
                // A tap on a touch screen: pointerenter fires for it too, but only
                // once per bar, so a second tap on the same bar could not dismiss it.
                onClick={() => setHover((h) => (h === i ? null : i))}
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

        <line class="axis" x1={padL} x2={W} y1={padT + plot} y2={padT + plot} />
        {data.length > 0 && (
          <>
            <text class="axis-text" x={padL} y={H - 4}>
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
          style={`left:${((padL + (hover + 0.5) * slot) / W) * 100}%; top:-2px`}
        >
          {label(hovered.date)} · {Math.round(hovered.minutes)} min
        </div>
      )}
    </div>
  );
}

/** A step that puts three or four round numbers up the side: 10, 15, 30, 60… minutes. */
function niceStep(max: number): number {
  for (const s of [5, 10, 15, 30, 60, 120, 180, 240]) if (max / s <= 4) return s;
  return 300;
}

const label = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
