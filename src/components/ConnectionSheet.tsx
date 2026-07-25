import { useState } from 'preact/hooks';
import { Sheet } from './Sheet.js';
import { LogPanel } from './LogPanel.js';
import {
  connect,
  disconnect,
  doStop,
  driver,
  deviceName,
  connected,
  supported,
  beltLabel,
  beltTone,
} from '../state/connection.js';
import { live, isMoving } from '../state/telemetry.js';
import { status, logLines } from '../state/log.js';
import { toMph } from '../lib/format.js';

export function ConnectionSheet({ onClose }: { onClose: () => void }) {
  const d = driver.value;
  const t = live.value;
  const [copied, setCopied] = useState(false);

  const copyLog = () => {
    const text = logLines.value.map((l) => `${l.t}  ${l.msg}`).join('\n');
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Sheet title="Connection" onClose={onClose}>
      {/* The sheet sits above the pinned stop bar and would otherwise hide the one
          control that must always be reachable — leaving Disconnect as the only red
          button on screen, which does not stop the belt. So Stop comes with it. */}
      {connected.value && isMoving.value && (
        <div class="sheet-stop">
          <button class="btn danger block" onClick={() => void doStop()}>
            Stop
          </button>
        </div>
      )}

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
      ) : (
        <div style="display:grid;gap:.5rem">
          <button
            class="btn primary block"
            disabled={!supported.value}
            onClick={() => {
              void connect({ filtered: true });
              onClose();
            }}
          >
            Connect
          </button>
          <button
            class="btn block"
            disabled={!supported.value}
            onClick={() => {
              void connect({ filtered: false });
              onClose();
            }}
          >
            Show all devices
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

      {logLines.value.length > 0 && (
        <button class="table-toggle" onClick={copyLog}>
          {copied ? 'Copied' : 'Copy log'}
        </button>
      )}
    </Sheet>
  );
}
