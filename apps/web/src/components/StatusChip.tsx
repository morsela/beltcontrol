import { beltTone, beltLabel, deviceName, phase } from '../state/connection.js';
import { status } from '../state/log.js';
import { LinkDot } from './LinkDot.js';

/**
 * Ambient connection indicator, replacing the old connect panel once connected.
 *
 * The coloured dot is never the only signal: the label beside it always names the
 * state in words. Measured reason — warn (#e0a33a) and bad (#ff6b5e) separate by
 * only dE 5.7 under deuteranopia, so colour alone would be unreadable for a
 * meaningful share of users.
 *
 * It is also the screen's one live region. A failed Start, a rejected speed write
 * or a stop the belt never confirmed used to land in a separate status line that
 * spent the rest of its life saying "ready" — so the chip carries those instead,
 * standing in for the belt state while something is actually wrong. Nothing is
 * truncated: it wraps, because "Stop was sent but the belt has not confirmed" is
 * not a message to cut short. The chip is a button either way, and the sheet
 * behind it has the full history.
 */
export function StatusChip({ onOpen }: { onOpen: () => void }) {
  const busy = phase.value === 'connecting' || phase.value === 'choosing';
  const err = status.value.kind === 'err' ? status.value.text : '';
  return (
    <button
      class={`chip${err ? ' chip-err' : ''}`}
      onClick={onOpen}
      aria-label={
        err
          ? `${err} Open connection details.`
          : `Connection: ${beltLabel.value}. Open connection details.`
      }
    >
      <LinkDot tone={err ? 'bad' : beltTone.value} busy={busy} />
      {/* The live region is the inner text, not the button: re-announcing the
          accessible name of a focusable control on every state change fights with
          whatever the user is doing. */}
      <span aria-live="polite">{err || beltLabel.value}</span>
      {!err && deviceName.value && <span class="name">· {deviceName.value}</span>}
    </button>
  );
}
