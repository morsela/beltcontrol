import { useState } from 'preact/hooks';
import { Sheet } from './Sheet.js';
import { driver, deviceName, supported } from '../state/connection.js';
import { live } from '../state/telemetry.js';
import { logLines } from '../state/log.js';
import { sessions } from '../state/session.js';
import { download, stamped } from '../lib/download.js';
import { SUPPORT_EMAIL } from '../lib/links.js';
import {
  diagnosticLines,
  fitMailto,
  renderReport,
  subjectFor,
  type ReportInput,
} from '../lib/feedback.js';

/**
 * Write to support, optionally with the protocol log attached.
 *
 * Nothing here posts anywhere: the report is built in the page and handed to the
 * user's mail client, which is the only thing that transmits it. That is not a
 * limitation worked around, it is the same promise the rest of the app makes — the
 * server ships static files and never sees a walk. It does mean the report is shown
 * in full, in the exact words that will be sent, before anything opens.
 *
 * The diagnostics are opt-out rather than opt-in. A bug report without them costs
 * support two round trips, and the project explicitly asks for the log when a pad
 * speaks a protocol that has not been decoded — but the checkbox is right there, and
 * the preview above it is the real disclosure.
 */
export function FeedbackSheet({ onClose }: { onClose: () => void }) {
  const [message, setMessage] = useState('');
  const [share, setShare] = useState(true);
  const [copied, setCopied] = useState(false);

  const d = driver.value;
  const t = live.value;
  const device = deviceName.value;

  const lines = logLines.value.map((l) => `${l.t}  ${l.msg}`);
  const diagnostics = share
    ? diagnosticLines({
        appVersion: __APP_VERSION__,
        userAgent: navigator.userAgent,
        bluetooth: supported.value,
        protocol: d?.name ?? null,
        device,
        beltState: t.stateLabel != null ? `${t.stateLabel} (${t.state})` : null,
        speedRange: d ? `${d.minSpeedKmh}–${d.maxSpeedKmh} km/h` : null,
        sessionCount: sessions.value.length,
      })
    : null;

  const input: ReportInput = { message, diagnostics, log: share ? lines : [] };
  const subject = subjectFor(device);
  const full = renderReport(input);
  const fitted = fitMailto(subject, input);
  const trimmed = fitted.logShown < fitted.logTotal || fitted.messageTruncated;

  const copy = () => {
    void navigator.clipboard.writeText(full).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Sheet title="Send feedback" onClose={onClose}>
      <p class="note" style="margin:0 0 1rem">
        Goes to {SUPPORT_EMAIL}. The page sends nothing itself — it writes the mail and
        opens it in your own mail app, so you can read it, change it, or drop it.
      </p>

      <label class="field">
        <span class="field-label">What happened?</span>
        <textarea
          class="field-input"
          rows={5}
          value={message}
          placeholder="What you did, what the belt did, and what you expected instead."
          onInput={(e) => setMessage((e.currentTarget as HTMLTextAreaElement).value)}
        />
      </label>

      <label class="check">
        <input
          type="checkbox"
          checked={share}
          onChange={(e) => setShare((e.currentTarget as HTMLInputElement).checked)}
        />
        <span>
          Include diagnostics
          <span class="note">
            {' '}
            {lines.length > 0
              ? `— browser, protocol, and ${lines.length} log line${lines.length === 1 ? '' : 's'}.`
              : '— browser and protocol. Nothing has been logged yet.'}{' '}
            No sessions, no history.
          </span>
        </span>
      </label>

      {/* The preview is the disclosure. A sentence claiming what gets sent is a claim;
          the actual text, scrollable and copyable, is the thing itself. */}
      <details class="logbox">
        <summary>Exactly what will be sent</summary>
        <pre class="log">{full}</pre>
      </details>

      {trimmed && (
        <p class="hint" style="margin-top:0">
          {fitted.messageTruncated
            ? 'A mail link cannot carry a message this long, so the email will hold the beginning of it.'
            : fitted.logShown === 0
              ? `A mail link cannot carry ${fitted.logTotal} log lines, so the email will go without them.`
              : `A mail link cannot carry ${fitted.logTotal} log lines, so the email will hold the last ${fitted.logShown}.`}{' '}
          Save the report and attach it if the rest matters.
        </p>
      )}

      <div class="data-actions" style="margin-top:1rem">
        {/* An anchor, not a scripted navigation: the address is visible on hover and in
            the status bar before it is clicked, and no popup heuristic can eat it. */}
        <a class="btn primary" href={fitted.url}>
          Open email
        </a>
        <button class="btn" onClick={copy}>
          {copied ? 'Copied' : 'Copy report'}
        </button>
        <button
          class="btn"
          onClick={() => download(stamped('report', 'txt'), full, 'text/plain')}
        >
          Save report
        </button>
      </div>

      <p class="note" style="margin-top:1rem">
        No mail app set up? Copy the report and send it to {SUPPORT_EMAIL} however you
        like.
      </p>
    </Sheet>
  );
}

/** Opens the sheet from wherever it is dropped. Owns its own state so a caller can
 *  render one line and be done — the footer does exactly that on every screen. */
export function FeedbackLink({ class: cls = 'table-toggle' }: { class?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button class={cls} onClick={() => setOpen(true)}>
        Send feedback
      </button>
      {open && <FeedbackSheet onClose={() => setOpen(false)} />}
    </>
  );
}
