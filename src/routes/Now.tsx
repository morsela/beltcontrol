import { useState } from 'preact/hooks';
import { Hero } from '../components/Hero.js';
import { GoalMeter } from '../components/GoalMeter.js';
import { Tiles } from '../components/Tiles.js';
import { SpeedControl } from '../components/SpeedControl.js';
import { ConnectionSheet } from '../components/ConnectionSheet.js';
import { FeedbackSheet } from '../components/FeedbackSheet.js';
import { ConfirmDialog } from '../components/ConfirmDialog.js';
import { StatusChip } from '../components/StatusChip.js';
import { TreadStrip } from '../components/TreadStrip.js';
import { Brand } from '../components/Logo.js';
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
  startPending,
} from '../state/connection.js';
import { isMoving } from '../state/telemetry.js';
import { settings } from '../state/settings.js';
import { isDesktop } from '../lib/viewport.js';
import { toMph } from '../lib/format.js';

export function Now({ onAmbient }: { onAmbient: () => void }) {
  const [sheet, setSheet] = useState(false);
  const [feedback, setFeedback] = useState(false);
  // Which kind of "the belt is about to move" is waiting on a yes, if any. Resuming is
  // confirmed exactly like starting: it may not be the person who paused it standing on
  // the belt now.
  const [confirming, setConfirming] = useState<'start' | 'resume' | null>(null);
  const d = driver.value;

  // `running` and not just telemetry: a start or resume that has been written but not
  // yet confirmed is outstanding, and a second one stacked on top of it is not what
  // pressing the button again means. When the belt never confirms, `running` goes back
  // to false and the button returns.
  const canStart = !isMoving.value && !running.value;

  return (
    <>
      {/* Only on a phone. On desktop this route is the rail, and the top bar above it
          is already carrying the lockup — a second one a few hundred pixels away is
          not branding, it is a duplicate. */}
      {!isDesktop.value && <Brand class="page-brand" />}

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
        {/* Only once something is connected: with no pad there is no speed to report,
            and a still strip over "Not connected" would be a readout of nothing. */}
        {connected.value && <TreadStrip />}
        <Hero onLongPress={onAmbient} />
        <GoalMeter />
        <Tiles />
      </div>

      {connected.value ? (
        <>
          <SpeedControl />

          {/* Only wrap in a card when there is something to put in it — with no
              Start button and no mode row, an empty panel is just noise. */}
          {(canStart || d?.capabilities.mode) && (
            <div class="card">
              {canStart &&
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

      {connected.value && (
        <p class="hint" style="margin-bottom:var(--gap)">
          Esc stops the belt. Closing this page does not.
        </p>
      )}

      {/* A silent pad makes an outstanding stop look exactly like a start telemetry has
          not caught up with, so name the command that is actually outstanding. Both sit
          beside the control they belong to; only the failure that follows goes to the
          chip. `startPending` rather than `running && !isMoving`: a pad that reports
          `runState 1` before it reports any speed has confirmed the start, and this
          note is no longer true of it. */}
      {stopPending.value ? (
        <p class="note" style="margin-bottom:var(--gap)">
          Stop command sent — waiting for the belt to report zero.
        </p>
      ) : (
        startPending.value && (
          <p class="note" style="margin-bottom:var(--gap)">
            Start command sent — waiting for the belt to report movement.
          </p>
        )
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
      {sheet && (
        <ConnectionSheet
          onClose={() => setSheet(false)}
          onFeedback={() => {
            setSheet(false);
            setFeedback(true);
          }}
        />
      )}

      {feedback && <FeedbackSheet onClose={() => setFeedback(false)} />}
    </>
  );
}
