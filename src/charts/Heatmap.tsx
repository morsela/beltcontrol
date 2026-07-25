import type { DayTotal } from '../state/session.js';
import { fmtDayLabel } from '../lib/format.js';

/**
 * Consistency grid. Magnitude across a grid, so: sequential, one hue, light to dark.
 * The steps come from the --seq-* ramp in tokens.css, which is selected per theme
 * rather than flipped.
 */
const EMPTY = 'var(--seq-empty)';
const STEPS = ['var(--seq-1)', 'var(--seq-2)', 'var(--seq-3)', 'var(--seq-4)', 'var(--seq-5)'];

function stepFor(minutes: number, goal: number): string {
  if (minutes <= 0) return EMPTY;
  const ratio = goal > 0 ? minutes / goal : minutes / 60;
  return STEPS[Math.min(STEPS.length - 1, Math.floor(ratio * STEPS.length))]!;
}

export function Heatmap({ data, goalMinutes }: { data: DayTotal[]; goalMinutes: number }) {
  // Pad the front so the first column starts on a Sunday and the 7 rows line up
  // with weekdays.
  const lead = data.length > 0 ? new Date(data[0]!.date).getDay() : 0;
  const cells: (DayTotal | null)[] = [...Array<null>(lead).fill(null), ...data];

  return (
    <>
      <div class="heat" role="img" aria-label={`Walking consistency over the last ${data.length} days`}>
        {cells.map((d, i) =>
          d ? (
            <i
              key={d.key}
              style={`background:${stepFor(d.minutes, goalMinutes)}`}
              title={`${fmtDayLabel(d.date)} · ${Math.round(d.minutes)} min`}
            />
          ) : (
            <i key={`pad-${i}`} style="background:transparent" />
          )
        )}
      </div>
      <div class="heat-legend">
        <span>less</span>
        {[EMPTY, ...STEPS].map((s) => (
          <i key={s} style={`background:${s}`} />
        ))}
        <span>more</span>
      </div>
    </>
  );
}
