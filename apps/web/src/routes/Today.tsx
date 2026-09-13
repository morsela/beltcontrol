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
import { GoalMeter } from '../components/GoalMeter.js';
import { FunFact } from '../components/FunFact.js';
import { StickerSheet } from '../components/StickerSheet.js';
import { NewSticker } from '../components/NewSticker.js';
import { isDesktop } from '../lib/viewport.js';
import { dayKey, fmtDuration, fmtMiles, fmtInt, fmtClock, EM_DASH } from '../lib/format.js';
import { trackEvent } from '../lib/analytics.js';

export function Today() {
  const [pendingDelete, setPendingDelete] = useState<Session | null>(null);
  const day = todayTotals.value;
  const open = currentSession.value;
  const list = sessionsOn(dayKey(Date.now()));
  const goal = settings.value.goalMinutes;
  // On desktop this screen leads with the day and carries the goal meter, which states
  // the ratio in full. On a phone the meter is over on Now, so the percentage has to be
  // said in the subtitle here or it is not on this screen at all.
  const dayLead = isDesktop.value;

  // The same two figures either way; only the first of the three changes size and
  // label between the layouts.
  const supporting = (
    <>
      <div class="stat">
        <span class="v tnum">{day.distKm > 0 ? fmtMiles(day.distKm) : EM_DASH}</span>
        <span class="k">mi</span>
      </div>
      <div class="stat">
        <span class="v tnum">{day.steps > 0 ? fmtInt(day.steps) : EM_DASH}</span>
        <span class="k">steps</span>
      </div>
    </>
  );

  return (
    <>
      <h1 class="page">Today</h1>

      {/* The day, stated once, and the note beside it. Two thirds and one third on
          desktop; stacked on a phone, where a 10rem note column is unreadable. */}
      <div class="today-lead">
        <div class="card">
          {/* The session count as a tag pinned to the card's top edge rather than a
              subtitle under the page name. It is one short clause about what is on the
              card, and it belongs on the card. */}
          {list.length > 0 && (
            <span class="card-tag">
              {list.length} session{list.length === 1 ? '' : 's'}
              {open ? ', one running' : ''}
            </span>
          )}

          <p class="lead-hand">Today you walked</p>

          {dayLead ? (
            <div class="day-lead">
              <div class="day-primary">
                <span class="v tnum">{fmtDuration(Math.round(day.minutes * 60))}</span>
              </div>
              <div class="day-side">{supporting}</div>
            </div>
          ) : (
            <div class="stat-row">
              <div class="stat">
                <span class="v tnum">{fmtDuration(Math.round(day.minutes * 60))}</span>
                <span class="k">walked</span>
              </div>
              {supporting}
            </div>
          )}

          {/* The meter belongs to this screen on desktop and to Now on a phone, where
              the two are separate screens and stating it in both is not a repetition.
              Down there Today still owes the ratio a mention, or the day's progress is
              only on the other screen. */}
          {dayLead ? (
            <GoalMeter />
          ) : (
            goal > 0 &&
            list.length > 0 && (
              <p class="note" style="margin-top:.6rem">
                {Math.round((day.minutes / goal) * 100)}% of today's goal.
              </p>
            )
          )}

          {/* No live line here, deliberately. The walk in progress has two homes already —
              the rail says what the belt is doing this second, and the session list below
              is the register every session is entered in, open one included. A third
              statement of the same minutes is the habit this layout exists to break. */}

          {list.length === 0 && <p class="note" style="margin-top:.9rem">No walking recorded yet.</p>}

          {day.excluded > 0 && (
            <p class="note" style="margin-top:.9rem">
              {day.excluded} session{day.excluded === 1 ? '' : 's'} excluded from the
              distance total: recorded on a protocol whose distance scale this project had
              not established at the time, so summing it would invent a number.
            </p>
          )}
        </div>

        <FunFact />
      </div>

      {/* Three across on desktop: what you have collected, what the belt just did, and
          the register of the day. Stacked on a phone. */}
      <div class="today-row">
        <div class="card">
          <p class="section-title" style="margin-top:0">Stickers</p>
          <StickerSheet />
        </div>

        <div class="card">
          <p class="section-title" style="margin-top:0">Speed this session (mph)</p>
          {open && open.samples.length >= 2 ? (
            <AreaChart
              samples={open.samples}
              width={isDesktop.value ? 340 : 320}
              height={isDesktop.value ? 150 : 120}
            />
          ) : (
            <p class="empty">Nothing to trace yet. This fills in as the belt moves.</p>
          )}
        </div>

        <div class="card">
          <p class="section-title" style="margin-top:0">Sessions</p>
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
          <NewSticker />
        </div>
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
            trackEvent('session_deleted');
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
