import { useEffect, useRef } from 'preact/hooks';
import { logLines } from '../state/log.js';

/**
 * A diagnostic, not a primary surface — so it lives inside the connection sheet
 * rather than on the screen you glance at while walking. It stays in the app at all
 * because the project asks people to share it when a pad speaks a protocol that has
 * not been decoded yet.
 */
export function LogPanel({ defaultOpen = false }: { defaultOpen?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const lines = logLines.value;

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  return (
    <details class="logbox" open={defaultOpen}>
      <summary>Protocol log ({lines.length})</summary>
      <div class="log" ref={ref} role="log" aria-live="polite" aria-label="Protocol log">
        {lines.map((l) => (
          <div class={l.kind} key={l.id}>
            {l.t}  {l.msg}
          </div>
        ))}
      </div>
    </details>
  );
}
