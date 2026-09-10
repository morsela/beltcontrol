import { Sheet } from './Sheet.js';

/**
 * Replaces `window.confirm`.
 *
 * The native one cannot be styled, blocks the event loop, and — the reason it had
 * to go — takes focus and the Escape key out of the app's hands entirely, which is
 * untenable once Esc is load-bearing. Cancel comes first in the DOM so it is what
 * the dialog focuses and what Enter hits.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  tone = 'primary',
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Sheet title={title} onClose={onCancel}>
      <p class="dialog-body">{body}</p>
      <div class="dialog-actions">
        <button class="btn" onClick={onCancel}>
          Cancel
        </button>
        <button class={`btn ${tone}`} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Sheet>
  );
}
