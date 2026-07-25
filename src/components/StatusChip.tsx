import { beltTone, beltLabel, deviceName, phase } from '../state/connection.js';

/**
 * Ambient connection indicator, replacing the old connect panel once connected.
 *
 * The coloured dot is never the only signal: the label beside it always names the
 * state in words. Measured reason — warn (#e0a33a) and bad (#ff6b5e) separate by
 * only dE 5.7 under deuteranopia, so colour alone would be unreadable for a
 * meaningful share of users.
 */
export function StatusChip({ onOpen }: { onOpen: () => void }) {
  const busy = phase.value === 'connecting' || phase.value === 'choosing';
  return (
    <button
      class="chip"
      onClick={onOpen}
      aria-label={`Connection: ${beltLabel.value}. Open connection details.`}
    >
      <span class={`dot ${beltTone.value}${busy ? ' pulsing' : ''}`} aria-hidden="true" />
      <span>{beltLabel.value}</span>
      {deviceName.value && <span class="name">· {deviceName.value}</span>}
    </button>
  );
}
