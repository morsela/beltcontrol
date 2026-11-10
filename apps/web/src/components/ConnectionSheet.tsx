import { useEffect, useRef, useState } from 'preact/hooks';
import { Sheet } from './Sheet.js';
import { LogPanel } from './LogPanel.js';
import {
  connect,
  connectSimulated,
  disconnect,
  driver,
  deviceName,
  connected,
  supported,
  beltLabel,
  beltTone,
  beltMayBeMoving,
  doStop,
} from '../state/connection.js';
import { live, lastFrameAt } from '../state/telemetry.js';
import { status, logLines } from '../state/log.js';
import { toMph } from '../lib/format.js';
import { units } from '../state/settings.js';
import { fmtFrameAge } from '../lib/pulse.js';

export function ConnectionSheet({
  onClose,
  onFeedback,
}: {
  onClose: () => void;
  /** Hands the caller the job of opening the feedback sheet, so this one can close
   *  first. Two modals stacked would each trap focus and each paint a backdrop, and
   *  the second Esc would land on a dialog nobody could see the whole of. */
  onFeedback: () => void;
}) {
  const d = driver.value;
  const t = live.value;
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  // Disconnect asked for while the belt may be moving: answered in place, below.
  const [leaving, setLeaving] = useState(false);
  // Swapping the button for the question unmounts whichever of them had the focus, and
  // focus that falls to <body> takes the sheet's Esc and Tab handling with it. So it is
  // carried across by hand: onto the safe answer when the question appears, and back
  // onto Disconnect when it is withdrawn.
  const stayRef = useRef<HTMLButtonElement>(null);
  const disconnectRef = useRef<HTMLButtonElement>(null);
  const asked = useRef(false);
  useEffect(() => {
    if (leaving) stayRef.current?.focus();
    else if (asked.current) disconnectRef.current?.focus();
    asked.current = leaving;
  }, [leaving]);

  // The age of the last frame only changes because time passes, so it needs a clock of
  // its own — nothing in the signal graph moves when a pad goes silent, which is
  // exactly the case this row exists to show. Runs only while the sheet is open.
  const frameAt = lastFrameAt.value;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);

  const copyLog = () => {
    const text = logLines.value.map((l) => `${l.t}  ${l.msg}`).join('\n');
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Sheet title="Connection" onClose={onClose}>
      {/* Stop is not rendered here: `Sheet` carries it for every dialog, so no modal
          in the app can hide the one control that must always be reachable. */}
      <dl class="meta">
        <dt>State</dt>
        <dd>
          <span class={`dot ${beltTone.value}`} aria-hidden="true" style="display:inline-block;margin-right:6px" />
          {beltLabel.value}
        </dd>

        <dt>Device</dt>
        <dd>{deviceName.value ?? 'not connected'}</dd>

        <dt>Protocol</dt>
        <dd>{d?.name ?? '—'}</dd>

        {/* The ring on the chip says frames are arriving; this says when the last one
            did. A link that has gone quiet is the first thing to establish when a pad
            has stopped answering, and until now the only way to see it was to watch
            the protocol log stop scrolling. Not styled as an error at any age: an old
            frame is a fact, not a verdict the app has reached. */}
        <dt>Last frame</dt>
        <dd class="tnum">{frameAt == null ? '—' : fmtFrameAge(now - frameAt)}</dd>

        <dt>Belt state</dt>
        {/* The raw code stays visible beside the guessed label so a wrong guess is
            obvious rather than silently believed. */}
        <dd>{t.stateLabel != null ? `${t.stateLabel} · code ${t.state}` : '—'}</dd>

        <dt>Speed range</dt>
        <dd>
          {d
            ? units.value === 'metric'
              ? `${d.minSpeedKmh}–${d.maxSpeedKmh} km/h`
              : `${toMph(d.minSpeedKmh).toFixed(1)}–${toMph(d.maxSpeedKmh).toFixed(1)} mph ` +
                `(${d.minSpeedKmh}–${d.maxSpeedKmh} km/h)`
            : '—'}
        </dd>

        {/* A row like the others, with a name. It used to be a bare coloured word
            between the table and the button — "running", belonging to nothing. */}
        {status.value.text && (
          <>
            <dt>Last message</dt>
            <dd class={`hint ${status.value.kind}`} style="margin:0;font-size:inherit">
              {status.value.text}
            </dd>
          </>
        )}
      </dl>

      {connected.value && leaving ? (
        // Dropping the link leaves the belt exactly as it is, and once it is dropped
        // nothing on this page can stop it. That was one tap away from a moving belt,
        // with the consequence explained in a note underneath the button. Asked here
        // rather than in a second dialog stacked on this one.
        <div class="confirm-inline" role="group" aria-label="Disconnect while the belt is moving">
          <p>
            <strong>The belt is still moving.</strong> Disconnecting doesn&rsquo;t stop it,
            and once disconnected this page can&rsquo;t. You&rsquo;d have to stop it at
            the treadmill.
          </p>
          <button
            class="btn danger block"
            onClick={() => {
              // Stop first and let it go out before the link is dropped. If the write
              // fails, `doStop` has already put the reason on the chip — and the link
              // stays up, because a failed stop is the worst moment to lose it.
              void doStop().then(() => {
                if (status.value.kind === 'err') return;
                void disconnect();
                onClose();
              });
            }}
          >
            Stop the belt, then disconnect
          </button>
          <button
            class="btn block"
            onClick={() => {
              void disconnect();
              onClose();
            }}
          >
            Disconnect and leave it running
          </button>
          <button class="btn ghost block" ref={stayRef} onClick={() => setLeaving(false)}>
            Stay connected
          </button>
        </div>
      ) : connected.value ? (
        // Not `danger`: dropping the link is the least destructive thing on this
        // sheet — it leaves the belt exactly as it is. Red is reserved for Stop.
        <button
          class="btn block"
          ref={disconnectRef}
          onClick={() => {
            if (beltMayBeMoving.value) {
              setLeaving(true);
              return;
            }
            void disconnect();
            onClose();
          }}
        >
          Disconnect
        </button>
      ) : supported.value ? (
        <div style="display:grid;gap:.5rem">
          <button
            class="btn primary block"
            onClick={() => {
              void connect({ filtered: true });
              onClose();
            }}
          >
            Connect
          </button>
          <button
            class="btn block"
            onClick={() => {
              void connect({ filtered: false });
              onClose();
            }}
          >
            Show all devices
          </button>
        </div>
      ) : (
        // No disabled buttons: this browser will never connect, and a control that
        // cannot work should not be on screen looking broken. What replaces them is
        // what actually works here — take the link elsewhere, or run the simulator.
        <div style="display:grid;gap:.5rem">
          <button
            class="btn primary block"
            onClick={() => {
              void navigator.clipboard
                .writeText(location.href)
                .then(() => {
                  setLinkCopied(true);
                  window.setTimeout(() => setLinkCopied(false), 1500);
                })
                .catch(() => {
                  /* clipboard refused — the address bar still has the URL */
                });
            }}
          >
            {linkCopied ? 'Link copied' : 'Copy link to open in Chrome'}
          </button>
          <button
            class="btn block"
            onClick={() => {
              void connectSimulated();
              onClose();
            }}
          >
            Try it with a simulated pad
          </button>
        </div>
      )}

      {/* One note for each situation rather than both sentences always. Which browsers
          work is no use to somebody who is connected, and what disconnecting does is no
          use to somebody who is not. */}
      <p class="note" style="margin-top:1rem">
        {connected.value
          ? 'Disconnecting leaves the belt doing whatever it was doing. It doesn\u2019t stop it.'
          : 'Works in Chrome, Edge, Opera and Samsung Internet. Firefox and Safari, including every browser on an iPhone or iPad, can\u2019t connect to Bluetooth devices.'}
      </p>

      {/* Kept because the project asks people to share this when a pad speaks an
          undecoded protocol — but behind a disclosure, off the main screen.
          Opens by default once something has actually gone wrong. */}
      <LogPanel defaultOpen={status.value.kind === 'err'} />

      {/* Copying the log only helps someone who already knows where to send it. The
          second button is the answer to "and then what" — it carries the same lines,
          addressed, with the browser and protocol filled in. */}
      <div class="log-actions">
        {logLines.value.length > 0 && (
          <button class="table-toggle" onClick={copyLog}>
            {copied ? 'Copied' : 'Copy log'}
          </button>
        )}
        <button class="table-toggle" onClick={onFeedback}>
          Send to support
        </button>
      </div>
    </Sheet>
  );
}
