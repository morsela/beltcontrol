import type { ComponentChildren } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useRef } from 'preact/hooks';
import { openDialogs } from '../state/ui.js';
import { beltMayBeMoving, doStop } from '../state/connection.js';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'details > summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Rendered but hidden elements (a closed <details>) must not swallow the focus. */
const visible = (el: HTMLElement) =>
  el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0;

const focusables = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(visible);

/**
 * The app's one modal. A bottom sheet on a phone, a centred dialog on desktop.
 *
 * It declares `aria-modal`, so it owes the keyboard everything that implies: focus
 * moves in on open, Tab cycles inside, Esc closes, and focus returns to whatever
 * opened it. It also owes the user a way out that is visible — Esc alone is not a
 * discoverable affordance, hence the close button.
 *
 * Rendered into <body> rather than where it is written. On desktop the two columns
 * both open dialogs and both sit in stacking contexts of their own (the rail is
 * `position: sticky`, which makes one whatever its z-index), so whichever column
 * loses the ordering paints its dialogs behind the other — the delete confirmation
 * in the content column used to come up underneath the rail. From <body> a dialog
 * is ordered against the page rather than against the column that opened it.
 */
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ComponentChildren;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Held in a ref so the cleanup closes over the handler that is actually current.
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const restore = document.activeElement as HTMLElement | null;
    openDialogs.value++;

    // Prefer the first control in the body: the dialog's own Stop is first in the
    // DOM by design, and landing on it would make Enter a way to halt the belt by
    // accident. Stop must be reachable, not preselected.
    const target = (bodyRef.current ? focusables(bodyRef.current)[0] : null) ?? el;
    target.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // The global Esc handler checks openDialogs and stands down, so this does
        // not also stop the belt.
        close.current();
        return;
      }
      if (e.key !== 'Tab') return;

      const items = focusables(el);
      if (items.length === 0) {
        e.preventDefault();
        el.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (!e.shiftKey && (active === last || !el.contains(active))) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && (active === first || !el.contains(active))) {
        e.preventDefault();
        last.focus();
      }
    };

    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('keydown', onKey);
      openDialogs.value--;
      restore?.focus?.();
    };
  }, []);

  return createPortal(
    <div
      class="sheet-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div class="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
        <div class="sheet-head">
          <h2>{title}</h2>
          <button class="btn ghost sheet-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {/* No modal is allowed to hide Stop. The backdrop covers the pinned stop bar,
            and Esc now belongs to the dialog rather than to the belt, so the control
            has to travel with the thing that obscured it. */}
        {beltMayBeMoving.value && (
          <div class="sheet-stop">
            <button class="btn danger block" onClick={() => void doStop()}>
              Stop
            </button>
          </div>
        )}

        <div class="sheet-body" ref={bodyRef}>
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
