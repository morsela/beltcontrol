import { useEffect, useState } from 'preact/hooks';
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
} from '../state/connection.js';
import { live, lastFrameAt } from '../state/telemetry.js';
import { status, logLines } from '../state/log.js';
import { toMph } from '../lib/format.js';
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
        <dd>{t.stateLabel != null ? `${t.stateLabel} (${t.state})` : '—'}</dd>

        <dt>Speed range</dt>
        <dd>
          {d
            ? `${toMph(d.minSpeedKmh).toFixed(1)}–${toMph(d.maxSpeedKmh).toFixed(1)} mph ` +
              `(${d.minSpeedKmh}–${d.maxSpeedKmh} km/h)`
            : '—'}
        </dd>
      </dl>

      {status.value.text && (
        <p class={`hint ${status.value.kind}`} style="margin-top:0">
          {status.value.text}
        </p>
      )}

      {connected.value ? (
        // Not `danger`: dropping the link is the least destructive thing on this
        // sheet — it leaves the belt exactly as it is. Red is reserved for Stop.
        <button
          class="btn block"
          onClick={() => {
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

      <p class="note" style="margin-top:1rem">
        Disconnecting does not stop the belt. Needs Chrome, Edge, Opera or Samsung
        Internet over HTTPS or localhost — Firefox and Safari, including on iOS, do
        not support Web Bluetooth.
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
