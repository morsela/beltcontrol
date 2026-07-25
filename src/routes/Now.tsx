import { useState } from 'preact/hooks';
import { Hero } from '../components/Hero.js';
import { GoalMeter } from '../components/GoalMeter.js';
import { Tiles } from '../components/Tiles.js';
import { SpeedControl } from '../components/SpeedControl.js';
import { ConnectionSheet } from '../components/ConnectionSheet.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { StatusChip } from '../components/StatusChip.js';
import {
  connected,
  connect,
  supported,
  driver,
  doStart,
  doResume,
  endWalk,
  setMode,
  running,
  paused,
  stopPending,
} from '../state/connection.js';
import { isMoving } from '../state/telemetry.js';
import { settings } from '../state/settings.js';
import { status } from '../state/log.js';
import { toMph } from '../lib/format.js';

export function Now({ onAmbient }: { onAmbient: () => void }) {
  const [sheet, setSheet] = useState(false);
  // Which kind of "the belt is about to move" is waiting on a yes, if any. Resuming is
  // confirmed exactly like starting: it may not be the person who paused it standing on
  // the belt now.
  const [confirming, setConfirming] = useState<'start' | 'resume' | null>(null);
  const d = driver.value;

  return (
    <>
      <div class="topbar">
        <StatusChip onOpen={() => setSheet(true)} />
        {/* Ambient mode used to be reachable only by holding the hero number, which
            is no gesture at all on a keyboard — and the hint that it exists is
            hidden on protocols with a single metric. A button is both. */}
        {connected.value && (
          <button class="btn ghost topbar-btn" onClick={onAmbient}>
            Ambient
          </button>
        )}
      </div>

      <div class="card">
        <Hero onLongPress={onAmbient} />
        <GoalMeter />
        <Tiles />
      </div>

      {connected.value ? (
        <>
          <SpeedControl />

          {/* Only wrap in a card when there is something to put in it — with no
              Start button and no mode row, an empty panel is just noise. */}
          {(!isMoving.value || d?.capabilities.mode) && (
            <div class="card">
              {!isMoving.value &&
                (paused.value ? (
                  <>
                    <button
                      class="btn primary block lg"
                      onClick={() => setConfirming('resume')}
                    >
                      Resume at {toMph(settings.value.targetKmh).toFixed(1)} mph
                    </button>
                    <button class="btn ghost block" style="margin-top:.5rem" onClick={endWalk}>
                      End walk
                    </button>
                    <p class="hint">
                      Paused — the belt is stopped. The walk stays open for 15 minutes, so
                      resuming keeps it as one session rather than two.
                    </p>
                  </>
                ) : (
                  <button class="btn primary block lg" onClick={() => setConfirming('start')}>
                    Start
                  </button>
                ))}

              {d?.capabilities.mode && (
                <div class="mode-row">
                  <span class="note">Mode</span>
                  <button class="btn" onClick={() => void setMode(0)}>Auto</button>
                  <button class="btn" onClick={() => void setMode(1)}>Manual</button>
                  <button class="btn" onClick={() => void setMode(2)}>Standby</button>
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div class="card">
          <button
            class="btn primary block lg"
            disabled={!supported.value}
            onClick={() => void connect({ filtered: true })}
          >
            Connect to pad
          </button>
          <button
            class="btn block"
            style="margin-top:.5rem"
            disabled={!supported.value}
            onClick={() => void connect({ filtered: false })}
          >
            Show all devices
          </button>
        </div>
      )}

      {/* One live region, rendered in both states and never unmounted — a region
          inserted at the moment it gains text is not reliably announced.
          While connected it carries errors only: the chip already names the belt
          state, but a failed Start or speed write used to leave this screen
          completely silent, with the reason buried in the connection sheet. */}
      <p class={`hint ${status.value.kind}`} aria-live="polite">
        {!connected.value || status.value.kind === 'err' ? status.value.text : ''}
      </p>

      {/* Below the live region, so a failure lands directly under the control that
          failed rather than under a standing piece of advice. */}
      {connected.value && (
        <p class="hint" style="margin-bottom:var(--gap)">
          Esc stops the belt. Closing this page does not.
        </p>
      )}

      {/* `running` also stays true through a stop the belt has not confirmed, and a
          silent pad makes that look exactly like a start telemetry has not caught up
          with — so name the command that is actually outstanding. */}
      {running.value && !isMoving.value && !stopPending.value && (
        <p class="note" style="margin-bottom:var(--gap)">
          Start command sent — waiting for the belt to report movement.
        </p>
      )}

      {confirming && (
        <ConfirmDialog
          title={confirming === 'resume' ? 'Resume the belt?' : 'Start the belt?'}
          body={`The belt will ${
            confirming === 'resume' ? 'pick back up' : 'start moving'
          } at ${toMph(settings.value.targetKmh).toFixed(
            1
          )} mph. Make sure it is clear and you are ready.`}
          confirmLabel={confirming === 'resume' ? 'Resume' : 'Start'}
          onConfirm={() => {
            const kind = confirming;
            setConfirming(null);
            void (kind === 'resume' ? doResume() : doStart());
          }}
          onCancel={() => setConfirming(null)}
        />
      )}

      {/* The protocol log lives in the connection sheet, not here. It is a
          diagnostic — most people never need it, and it has no place on the
          screen you glance at while walking. */}
      {sheet && <ConnectionSheet onClose={() => setSheet(false)} />}
    </>
  );
}
