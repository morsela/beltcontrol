import { useState } from 'preact/hooks';
import {
  todayTotals,
  currentSession,
  sessionsOn,
  deleteSession,
  type Session,
} from '../state/session.js';
import { settings } from '../state/settings.js';
import { AreaChart } from '../charts/Area.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { isDesktop } from '../lib/viewport.js';
import { dayKey, fmtDuration, fmtMiles, fmtInt, fmtClock, EM_DASH } from '../lib/format.js';

export function Today() {
  const [pendingDelete, setPendingDelete] = useState<Session | null>(null);
  const day = todayTotals.value;
  const open = currentSession.value;
  const list = sessionsOn(dayKey(Date.now()));
  const goal = settings.value.goalMinutes;

  return (
    <>
      <h1 class="page">Today</h1>
      <p class="page-sub">
        {list.length === 0
          ? 'No walking recorded yet.'
          : `${list.length} session${list.length === 1 ? '' : 's'} · ${Math.round(
              (day.minutes / goal) * 100
            )}% of goal`}
      </p>

      <div class="card">
        <div class="stat-row">
          <div class="stat">
            <span class="v tnum">{fmtDuration(Math.round(day.minutes * 60))}</span>
            <span class="k">walked</span>
          </div>
          <div class="stat">
            <span class="v tnum">{day.distKm > 0 ? fmtMiles(day.distKm) : EM_DASH}</span>
            <span class="k">mi</span>
          </div>
          <div class="stat">
            <span class="v tnum">{day.steps > 0 ? fmtInt(day.steps) : EM_DASH}</span>
            <span class="k">steps</span>
          </div>
        </div>

        {day.excluded > 0 && (
          <p class="note" style="margin-top:.9rem">
            {day.excluded} session{day.excluded === 1 ? '' : 's'} excluded from the
            distance total: that protocol reports distance on a scale this project has
            not established, so summing it would invent a number.
          </p>
        )}
      </div>

      {open && open.samples.length >= 2 && (
        <div class="card">
          <p class="section-title" style="margin-top:0">Speed this session (mph)</p>
          <AreaChart
            samples={open.samples}
            width={isDesktop.value ? 720 : 320}
            height={isDesktop.value ? 150 : 120}
          />
        </div>
      )}

      <p class="section-title">Sessions</p>
      <div class="card">
        {list.length === 0 ? (
          <p class="empty">Walk for 30 seconds and it shows up here.</p>
        ) : (
          list.map((s) => (
            <SessionRow
              key={s.id}
              s={s}
              live={s.id === open?.id}
              onDelete={() => setPendingDelete(s)}
            />
          ))
        )}
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title="Delete this session?"
          body={`${fmtDuration(Math.round(pendingDelete.activeMs / 1000))} from ${fmtClock(
            pendingDelete.startedAt
          )} will be removed from this browser. There is no undo — export first if you want it.`}
          confirmLabel="Delete"
          tone="danger"
          onConfirm={() => {
            deleteSession(pendingDelete.id);
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </>
  );
}

function SessionRow({
  s,
  live,
  onDelete,
}: {
  s: Session;
  live: boolean;
  onDelete: () => void;
}) {
  return (
    <div class="session-item">
      <div>
        <div class="dur tnum">
          {fmtDuration(Math.round(s.activeMs / 1000))}
          {live && <span style="color:var(--accent);font-weight:400"> · in progress</span>}
        </div>
        <div class="when tnum">
          {fmtClock(s.startedAt)}
          {s.endedAt ? ` – ${fmtClock(s.endedAt)}` : ''}
          {s.trust.distKm === 'ok' && s.distKm > 0 ? ` · ${fmtMiles(s.distKm)} mi` : ''}
          {s.trust.steps === 'ok' && s.steps > 0 ? ` · ${fmtInt(s.steps)} steps` : ''}
        </div>
      </div>
      {!live && (
        <button
          class="btn ghost"
          style="min-height:36px;padding:.3rem .6rem"
          onClick={onDelete}
          aria-label={`Delete session from ${fmtClock(s.startedAt)}`}
        >
          Delete
        </button>
      )}
    </div>
  );
}
