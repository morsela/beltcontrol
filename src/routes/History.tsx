import { useRef, useState } from 'preact/hooks';
import { dailySeries, streak, sessions, exportCsv, lifetimeTotals } from '../state/session.js';
import { Odometer } from '../components/Odometer.js';
import { lifetimeHeadline, fmtOdometer } from '../lib/odometer.js';
import { exportJson, importBackup, BackupError } from '../state/backup.js';
import { settings } from '../state/settings.js';
import { ColumnChart } from '../charts/Column.js';
import { Heatmap } from '../charts/Heatmap.js';
import { isDesktop } from '../lib/viewport.js';
import { fmtDuration, fmtMiles, fmtDayLabel, EM_DASH } from '../lib/format.js';
import { download, stamped } from '../lib/download.js';
import { log } from '../state/log.js';

/**
 * Export, and the import that makes an export worth having: a backup nothing can read
 * back is a museum piece. Rendered on the empty screen too — restoring into a fresh
 * browser is exactly the case where there is no history to show yet.
 */
function DataCard() {
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ text: string; err?: boolean } | null>(null);
  const n = sessions.value.length;

  async function onFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    input.value = ''; // so picking the same file twice still fires a change
    if (!f) return;
    try {
      const r = importBackup(await f.text());
      const parts = [`${r.added} session${r.added === 1 ? '' : 's'} imported`];
      if (r.duplicate) parts.push(`${r.duplicate} already here`);
      if (r.skipped) parts.push(`${r.skipped} unreadable`);
      if (r.settingsRestored) parts.push('settings restored');
      setMsg({ text: `${parts.join(', ')}.` });
      log(`backup imported: ${parts.join(', ')}`, 'ok');
    } catch (err) {
      const text = err instanceof BackupError ? err.message : 'Could not read that file.';
      setMsg({ text, err: true });
      log(`backup import failed: ${text}`, 'err');
    }
  }

  return (
    <div class="card">
      <div class="data-actions">
        <button
          class="btn"
          disabled={n === 0}
          onClick={() => download(stamped('backup', 'json'), exportJson(), 'application/json')}
        >
          Export backup
        </button>
        <button
          class="btn"
          disabled={n === 0}
          onClick={() => download(stamped('sessions', 'csv'), exportCsv(), 'text/csv')}
        >
          Export CSV
        </button>
        <button class="btn" onClick={() => file.current?.click()}>
          Import backup
        </button>
      </div>
      <input ref={file} type="file" accept="application/json,.json" onChange={onFile} hidden />
      {msg && (
        <p class={msg.err ? 'hint err' : 'hint ok'} role="status">
          {msg.text}
        </p>
      )}
      <p class="note" style="margin-top:.6rem">
        {n} session{n === 1 ? '' : 's'} stored in this browser. Nothing is ever uploaded.
        The backup holds the complete record — every session, its speed samples and your
        settings — and importing one merges into what is already here rather than
        replacing it. The CSV is a flat summary for spreadsheets and cannot be read back.
      </p>
    </div>
  );
}

/**
 * Everything, ever, on wheels that turn while you walk.
 *
 * The 30-day card below it answers "am I keeping this up"; this answers the other
 * question a walking history gets asked, which is "how far have I actually got".
 * Deliberately one number: a lifetime figure people can quote, not a second stat row.
 */
function LifetimeCard() {
  const t = lifetimeTotals.value;
  const head = lifetimeHeadline(t);
  const text = fmtOdometer(head.value);
  const noun = head.unit === 'mi' ? 'miles' : 'hours';
  const since =
    t.since != null
      ? new Date(t.since).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
      : null;

  return (
    <div class="card">
      <div class="odo-row">
        <Odometer text={text} label={`${text} ${noun} in total.`} />
        <span class="odo-unit">{head.unit}</span>
      </div>
      <p class="note" style="margin-top:.6rem">
        {t.walks} walk{t.walks === 1 ? '' : 's'} on {t.days} day{t.days === 1 ? '' : 's'}
        {since ? `, since ${since}` : ''}.
      </p>
      {/* Same rule as every other total on this screen: say what is not in it. */}
      {head.fellBack ? (
        <p class="note" style="margin-top:.4rem">
          Counting hours rather than miles: no walk here came from a protocol that
          reports distance on a scale this project established, and hours are measured
          by this app rather than taken from the pad.
        </p>
      ) : (
        t.excluded > 0 && (
          <p class="note" style="margin-top:.4rem">
            {t.excluded} walk{t.excluded === 1 ? ' is' : 's are'} left out of this
            distance — the KingSmith 0x1234 protocol reports it on a scale nobody
            established, so those numbers are kept raw rather than summed as miles.
          </p>
        )
      )}
    </div>
  );
}

export function History() {
  const [showTable, setShowTable] = useState(false);
  const desktop = isDesktop.value;
  const goal = settings.value.goalMinutes;
  const last30 = dailySeries(30);
  // Whole weeks, so the heatmap grid is full columns. Twice as many of them on
  // desktop: the column is twice as wide, and filling it with more history beats
  // filling it with bigger squares.
  const heatDays = dailySeries(desktop ? 182 : 98);
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
        <DataCard />
      </>
    );
  }

  return (
    <>
      <h1 class="page">History</h1>

      <p class="section-title">Lifetime</p>
      <LifetimeCard />

      <p class="section-title">Last 30 days</p>
      <div class="card">
        <div class="stat-row">
          <div class="stat">
            <span class="v tnum">{fmtDuration(Math.round(totalMin * 60))}</span>
            <span class="k">total</span>
          </div>
          <div class="stat">
            <span class="v tnum">{totalKm > 0 ? fmtMiles(totalKm, 1) : EM_DASH}</span>
            <span class="k">mi</span>
          </div>
          <div class="stat">
            <span class="v tnum">{active}</span>
            <span class="k">active days</span>
          </div>
        </div>
      </div>

      <p class="section-title">Minutes per day</p>
      <div class="card">
        <ColumnChart
          data={last30}
          goalMinutes={goal}
          width={desktop ? 720 : 320}
          height={desktop ? 180 : 140}
        />
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
                  <th>mi</th>
                </tr>
              </thead>
              <tbody>
                {[...last30].reverse().filter((d) => d.minutes > 0).map((d) => (
                  <tr key={d.key}>
                    <td>{fmtDayLabel(d.date)}</td>
                    <td class="tnum">{Math.round(d.minutes)}</td>
                    <td class="tnum">{d.distKm > 0 ? fmtMiles(d.distKm) : EM_DASH}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p class="section-title">Consistency</p>
      <div class="card">
        <Heatmap data={heatDays} goalMinutes={goal} />
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
          aggregate rather than presented as a distance in miles.
        </p>
      )}

      <DataCard />
    </>
  );
}
