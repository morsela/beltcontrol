import { useEffect } from 'preact/hooks';
import { currentSession, todayTotals } from '../state/session.js';
import { live, isMoving } from '../state/telemetry.js';
import { doStop, doPause, doResume, canPause, paused } from '../state/connection.js';
import { requestWakeLock, releaseWakeLock } from '../lib/wakelock.js';
import { fmtDuration, fmtMph, fmt } from '../lib/format.js';

/**
 * What you leave on the tablet propped on the treadmill for three hours.
 *
 * Deliberately not a celebration screen: no rings filling, no streak nag, no
 * confetti. This sits in peripheral vision while you work, so its whole job is to
 * be legible and then be ignorable. Stop stays visible the entire time.
 */
export function AmbientView({ onExit }: { onExit: () => void }) {
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
          <button class="btn" onClick={() => void doResume()}>
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
        <button class="btn danger" onClick={() => void doStop()}>
          Stop
        </button>
      </div>
    </div>
  );
}
