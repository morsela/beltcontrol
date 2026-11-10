import { Fragment } from 'preact';
import { useState } from 'preact/hooks';
import type { DayTotal } from '../state/session.js';
import { fmtDayLabel } from '../lib/format.js';

/**
 * Consistency grid. Magnitude across a grid, so: sequential, one hue, light to dark.
 * The steps come from the --seq-* ramp in tokens.css, which is selected per theme
 * rather than flipped.
 *
 * Labelled on both edges: the month each run of weeks starts in along the top, and
 * three weekday initials down the side. Without them it was a field of squares with no
 * way to tell which one was last Tuesday.
 */
const EMPTY = 'var(--seq-empty)';
const STEPS = ['var(--seq-1)', 'var(--seq-2)', 'var(--seq-3)', 'var(--seq-4)', 'var(--seq-5)'];

/** Sunday first, to match the grid. Only alternate rows are lettered, to keep it quiet. */
const WEEKDAYS = ['', 'M', '', 'W', '', 'F', ''];

function stepFor(minutes: number, goal: number): string {
  if (minutes <= 0) return EMPTY;
  const ratio = goal > 0 ? minutes / goal : minutes / 60;
  return STEPS[Math.min(STEPS.length - 1, Math.floor(ratio * STEPS.length))]!;
}

const monthName = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short' });

export function Heatmap({ data, goalMinutes }: { data: DayTotal[]; goalMinutes: number }) {
  // The day whose figures are written out underneath. Hover sets it with a mouse and a
  // tap sets it on a touch screen — the only way in used to be a `title` tooltip, which
  // a phone never shows.
  const [sel, setSel] = useState<string | null>(null);

  // Pad the front so the first column starts on a Sunday and the 7 rows line up
  // with weekdays.
  const lead = data.length > 0 ? new Date(data[0]!.date).getDay() : 0;
  const cells: (DayTotal | null)[] = [...Array<null>(lead).fill(null), ...data];
  const weeks: (DayTotal | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  // A week is labelled when it is the first to hold a day of a new month. The very
  // first column is skipped unless it has room to run on: a name squeezed against the
  // next month's a column later is two words printed on top of each other.
  let prevMonth = -1;
  const monthFor = weeks.map((week, w) => {
    const first = week.find((d): d is DayTotal => d != null);
    if (!first) return '';
    const last = week[week.length - 1] ?? first;
    const month = new Date(last.date).getMonth();
    if (month === prevMonth) return '';
    const isFirstColumn = prevMonth === -1;
    prevMonth = month;
    if (isFirstColumn) {
      const next = weeks[w + 3]?.find((d): d is DayTotal => d != null);
      if (next && new Date(next.date).getMonth() !== month) return '';
    }
    return monthName(last.date);
  });

  const picked = sel != null ? data.find((d) => d.key === sel) : undefined;

  return (
    <>
      <div
        class="heat"
        role="img"
        aria-label={`Walking consistency over the last ${data.length} days`}
        onPointerLeave={(e) => {
          // A finger lifting is also a pointer leaving; keep what a tap picked.
          if (e.pointerType === 'mouse') setSel(null);
        }}
      >
        <span aria-hidden="true" />
        {WEEKDAYS.map((d, i) => (
          <span class="heat-d" key={`wd-${i}`} aria-hidden="true">
            {d}
          </span>
        ))}

        {weeks.map((week, w) => (
          <Fragment key={`w-${w}`}>
            <span class="heat-m" aria-hidden="true">
              {monthFor[w]}
            </span>
            {week.map((d, i) =>
              d ? (
                <i
                  key={d.key}
                  class={sel === d.key ? 'sel' : undefined}
                  style={`background:${stepFor(d.minutes, goalMinutes)}`}
                  title={`${fmtDayLabel(d.date)} · ${Math.round(d.minutes)} min`}
                  onPointerEnter={() => setSel(d.key)}
                  onClick={() => setSel(d.key)}
                />
              ) : (
                <i key={`pad-${w}-${i}`} style="background:transparent" />
              )
            )}
          </Fragment>
        ))}
      </div>
      <div class="heat-foot">
        <span class="tnum" aria-live="polite">
          {picked
            ? `${fmtDayLabel(picked.date)} · ${
                picked.minutes > 0 ? `${Math.round(picked.minutes)} min` : 'no walk'
              }`
            : 'Pick a day to see its minutes.'}
        </span>
        <div class="heat-legend">
          <span>less</span>
          {[EMPTY, ...STEPS].map((s) => (
            <i key={s} style={`background:${s}`} />
          ))}
          <span>more</span>
        </div>
      </div>
    </>
  );
}
