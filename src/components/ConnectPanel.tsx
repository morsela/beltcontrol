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
            Firefox and Safari can&rsquo;t connect to Bluetooth devices, and on an iPhone or
            iPad every browser is Safari underneath. Chrome, Edge, Opera and Samsung
            Internet can.{' '}
            <a href="/troubleshooting">More on why, and what to use instead.</a>
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
            Start, stop and set the speed over Bluetooth, without the phone app. Your walks
            are saved on this device and never uploaded.
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
              Pad not in the list? Some show up under a name you wouldn&rsquo;t
              recognise —{' '}<b>Show all devices</b> shows everything nearby.
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
              Most of them. The app asks your treadmill what it can do when you connect,
              so what matters is what is inside it rather than its model name:
            </p>
            <ul>
              <li>
                <b>Older pads</b> — A1, C1, C2, P1, R1/R2, K12 and similar: start, stop
                and speed
              </li>
              <li>
                <b>Newer pads</b> — Z1, Z3, P1E, MT1, W1, X21, G2 and others: the same,
                plus pause
              </li>
              <li>
                <b>KS-C2 and relatives</b> — G1, MX16, K12 Pro: the same, plus pause
              </li>
              <li>
                <b>Some other brands</b> — found and named, but not driveable yet
              </li>
            </ul>
            {/* The written page, not a repetition of it: every model seen on each
                protocol, and what each one can and cannot report. It leaves the app,
                which is why it is the last thing in here rather than beside Connect. */}
            <p>
              <a href="/compatible-treadmills">The full list</a> — every model, and which
              numbers each one can show you.
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
