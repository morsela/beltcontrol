import { useEffect, useState } from 'preact/hooks';
import { currentSession, todayTotals } from '../state/session.js';
import { live, isMoving } from '../state/telemetry.js';
import { doStop, doPause, doResume, canPause, paused, beltMayBeMoving } from '../state/connection.js';
import { settings } from '../state/settings.js';
import { ConfirmDialog } from './ConfirmDialog.js';
import { requestWakeLock, releaseWakeLock } from '../lib/wakelock.js';
import { fmtDuration, fmtMph, fmt, toMph } from '../lib/format.js';

/**
 * What you leave on the tablet propped on the treadmill for three hours.
 *
 * Deliberately not a celebration screen: no rings filling, no streak nag, no
 * confetti. This sits in peripheral vision while you work, so its whole job is to
 * be legible and then be ignorable. Stop stays visible for as long as the belt may
 * be moving, and never moves while it is there.
 */
export function AmbientView({ onExit }: { onExit: () => void }) {
  // Resuming from here gets the same dialog it gets on the Now screen. Pausing and
  // stopping do not: a belt coming to rest needs no permission.
  const [confirmResume, setConfirmResume] = useState(false);

  useEffect(() => {
    void requestWakeLock();
    return () => {
      void releaseWakeLock();
    };
  }, []);

  const session = currentSession.value;
  const secs = session ? Math.round(session.activeMs / 1000) : Math.round(todayTotals.value.minutes * 60);

  return (
    <div class="ambient">
      <div class="a-value tnum">{fmtDuration(secs)}</div>
      <div class="a-unit">
        {session ? (paused.value ? 'this session · paused' : 'this session') : 'walked today'}
      </div>

      <div class="a-secondary tnum">
        <span>{fmtMph(live.value.speedKmh)} mph</span>
        {session && session.trust.distKm === 'ok' && <span>{fmt(session.distKm, 2)} km</span>}
      </div>

      <div class="a-actions">
        <button class="btn ghost" onClick={onExit}>
          Exit
        </button>
        {/* Nothing here changes position when the belt does: Stop stays rightmost, and
            Pause and Resume take the same single slot beside it. */}
        {paused.value ? (
          <button class="btn" onClick={() => setConfirmResume(true)}>
            Resume
          </button>
        ) : (
          canPause.value &&
          isMoving.value && (
            <button class="btn" onClick={() => void doPause()}>
              Pause
            </button>
          )
        )}
        {/* Held to the same rule as every other Stop in the app: present for as long
            as the belt may be moving, gone once it says it is not. A belt that stopped
            itself — nobody stepped on, key pulled — leaves this screen with Exit, which
            is the only thing left to do from here. */}
        {beltMayBeMoving.value && (
          <button class="btn danger" onClick={() => void doStop()}>
            Stop
          </button>
        )}
      </div>

      {confirmResume && (
        <ConfirmDialog
          title="Resume the belt?"
          body={`The belt will pick back up at ${toMph(settings.value.targetKmh).toFixed(
            1
          )} mph. Make sure it is clear and you are ready.`}
          confirmLabel="Resume"
          onConfirm={() => {
            setConfirmResume(false);
            void doResume();
          }}
          onCancel={() => setConfirmResume(false)}
        />
      )}
    </div>
  );
}
