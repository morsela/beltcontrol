import { useState } from 'preact/hooks';
import { connect, connectSimulated, supported } from '../state/connection.js';
import { settings } from '../state/settings.js';
import { sessions } from '../state/session.js';

/**
 * Everything below the status chip while nothing is connected. Three states, decided
 * by two facts this browser already holds:
 *
 * - No Web Bluetooth: an explanation where the buttons were. The old rendering was two
 *   buttons at 40% opacity — unfocusable, unexplained, with the actual reason off in
 *   the chip. Nothing on this state pretends to be pressable; what remains (copy the
 *   link, run the simulator, read history) genuinely works here.
 *
 * - First run (never connected, no recorded history): orientation before numbers. The
 *   two questions every first visitor has — what does this do, where does my data go —
 *   answered in two sentences, with Connect directly under them.
 *
 * - Returning: the last pad offered back by name. The chooser still opens — Web
 *   Bluetooth grants nothing without a gesture through it — but arrives filtered to
 *   exactly that pad, so the gesture is one click on a one-entry list.
 *
 * The simulator link renders only on the first-run and unsupported states, where the
 * browser has no real history to mix demo walks into. A returning user has real miles
 * recorded, and a demo session in the middle of them helps nobody.
 */
export function ConnectPanel() {
  const [copied, setCopied] = useState(false);

  if (!supported.value) {
    const copyLink = () => {
      void navigator.clipboard
        .writeText(location.href)
        .then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        })
        .catch(() => {
          /* clipboard refused — the address bar still has the URL */
        });
    };
    return (
      <div class="card">
        <div class="unsupported">
          <strong>This browser can&rsquo;t talk to the treadmill</strong>
          <p>
            Firefox and Safari — including every browser on iOS — never implemented Web
            Bluetooth. Chrome, Edge, Opera and Samsung Internet have it, over HTTPS.{' '}
            <a href="/walkingpad-on-iphone">Why, and what is left on an iPhone.</a>
          </p>
        </div>
        <button class="btn primary block" onClick={copyLink}>
          {copied ? 'Link copied' : 'Copy link to open in Chrome'}
        </button>
        <button class="btn block" style="margin-top:.5rem" onClick={() => void connectSimulated()}>
          Try it with a simulated pad
        </button>
        <p class="note" style="margin-top:.75rem">
          History still works here — you can import a backup and browse past walks
          without Bluetooth.
        </p>
      </div>
    );
  }

  const remembered = settings.value.lastDeviceName;
  const firstRun = remembered == null && sessions.value.length === 0;

  return (
    <>
      {firstRun && (
        <div class="card intro">
          <strong>Drive your WalkingPad from this browser</strong>
          <p>
            Start, stop and set speed over Bluetooth — no phone app in the loop. Walks
            are recorded in this browser and never uploaded.
          </p>
        </div>
      )}

      <div class="card">
        {remembered != null ? (
          <>
            <button
              class="btn primary block lg"
              onClick={() => void connect({ filtered: true, name: remembered })}
            >
              Reconnect to {remembered}
            </button>
            <button
              class="btn ghost block"
              style="margin-top:.5rem"
              onClick={() => void connect({ filtered: true })}
            >
              Connect a different pad
            </button>
          </>
        ) : (
          <>
            <button
              class="btn primary block lg"
              onClick={() => void connect({ filtered: true })}
            >
              Connect to pad
            </button>
            <button
              class="btn block"
              style="margin-top:.5rem"
              onClick={() => void connect({ filtered: false })}
            >
              Show all devices
            </button>
            <p class="hint">
              Pad not in the list? Some units advertise under unexpected names —{' '}
              <b>Show all devices</b> shows everything nearby.
            </p>
          </>
        )}

        {/* Answered before the chooser opens, not after it comes up empty. Closed by
            default and only on first run: it is a pre-purchase-of-effort question, and
            anyone who has connected once has answered it with hardware. */}
        {firstRun && (
          <details class="compat">
            <summary>Which treadmills work?</summary>
            <p>
              The app probes the pad on connect and picks the protocol itself, so what
              matters is which of these your unit speaks — not its model name:
            </p>
            <ul>
              <li>
                <b>Classic</b> — A1, C1, C2, P1, R1/R2, K12 and most older pads: full
                control
              </li>
              <li>
                <b>FTMS</b> — Z1, Z3, P1E, MT1, W1, X21, G2 and other newer units: full
                control, with pause
              </li>
              <li>
                <b>KingSmith</b> — KS-C2, G1, MX16, K12 Pro: full control, with pause
              </li>
              <li>
                <b>FitShow</b> — some OEM units: detection only, no control yet
              </li>
            </ul>
            {/* The written page, not a repetition of it: every model seen on each
                protocol, and what each one can and cannot report. It leaves the app,
                which is why it is the last thing in here rather than beside Connect. */}
            <p>
              <a href="/compatible-treadmills">The full compatibility list</a> — every
              model, and which numbers each protocol can report.
            </p>
          </details>
        )}
      </div>

      {firstRun && (
        <button class="btn ghost block" onClick={() => void connectSimulated()}>
          Try it with a simulated pad
        </button>
      )}
    </>
  );
}
