import { useState } from 'preact/hooks';
import { dailySeries, streak, sessions, exportCsv } from '../state/session.js';
import { settings } from '../state/settings.js';
import { ColumnChart } from '../charts/Column.js';
import { Heatmap } from '../charts/Heatmap.js';
import { fmtDuration, fmt, fmtDayLabel, EM_DASH } from '../lib/format.js';

export function History() {
  const [showTable, setShowTable] = useState(false);
  const goal = settings.value.goalMinutes;
  const last30 = dailySeries(30);
  const last98 = dailySeries(98); // 14 weeks, so the heatmap grid is full columns
  const days = streak(goal);

  const totalMin = last30.reduce((a, d) => a + d.minutes, 0);
  const totalKm = last30.reduce((a, d) => a + d.distKm, 0);
  const active = last30.filter((d) => d.minutes > 0).length;
  const anyExcluded = last30.some((d) => d.excluded > 0);

  if (sessions.value.length === 0) {
    return (
      <>
        <h1 class="page">History</h1>
        <div class="card">
          <p class="empty">
            Nothing recorded yet. Sessions start themselves when the belt moves — you do
            not have to press anything.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <h1 class="page">History</h1>
      <p class="page-sub">Last 30 days</p>

      <div class="card">
        <div class="stat-row">
          <div class="stat">
            <span class="v tnum">{fmtDuration(Math.round(totalMin * 60))}</span>
            <span class="k">total</span>
          </div>
          <div class="stat">
            <span class="v tnum">{totalKm > 0 ? fmt(totalKm, 1) : EM_DASH}</span>
            <span class="k">km</span>
          </div>
          <div class="stat">
            <span class="v tnum">{active}</span>
            <span class="k">active days</span>
          </div>
        </div>
      </div>

      <p class="section-title">Minutes per day</p>
      <div class="card">
        <ColumnChart data={last30} goalMinutes={goal} />
        <p class="note" style="margin-top:.5rem">
          Dashed line is the {goal}-minute goal. Filled bars met it.
        </p>
        {/* A table view always exists alongside the chart. */}
        <button class="table-toggle" onClick={() => setShowTable((v) => !v)}>
          {showTable ? 'Hide table' : 'Show as table'}
        </button>
        {showTable && (
          <div class="scroll-x">
            <table class="data">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Minutes</th>
                  <th>km</th>
                </tr>
              </thead>
              <tbody>
                {[...last30].reverse().filter((d) => d.minutes > 0).map((d) => (
                  <tr key={d.key}>
                    <td>{fmtDayLabel(d.date)}</td>
                    <td class="tnum">{Math.round(d.minutes)}</td>
                    <td class="tnum">{d.distKm > 0 ? fmt(d.distKm, 2) : EM_DASH}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p class="section-title">Consistency</p>
      <div class="card">
        <Heatmap data={last98} goalMinutes={goal} />
        <p class="note" style="margin-top:.75rem">
          {days > 0
            ? `${days}-day streak at ${goal} min or more.`
            : `No active streak. Today counts once you pass ${goal} min.`}
        </p>
      </div>

      {anyExcluded && (
        <p class="note" style="margin-bottom:var(--gap)">
          Some sessions are excluded from the distance totals above. The KingSmith
          0x1234 protocol reports distance and calories on a scale this project never
          established, so those values are kept raw on the session and left out of every
          aggregate rather than presented as kilometres.
        </p>
      )}

      <div class="card">
        <button
          class="btn block"
          onClick={() => {
            const blob = new Blob([exportCsv()], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `belt-control-sessions-${new Date().toISOString().slice(0, 10)}.csv`;
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          Export CSV
        </button>
        <p class="note" style="margin-top:.6rem">
          {sessions.value.length} session{sessions.value.length === 1 ? '' : 's'} stored in
          this browser. Nothing is ever uploaded.
        </p>
      </div>
    </>
  );
}
