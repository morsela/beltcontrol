// Where the layout stops being a phone column and becomes a desktop workspace.
//
// The breakpoint is a shared constant rather than a bare number in two places: the
// shell branches on it in JS (Now is a pane on desktop, a route on mobile) and the
// stylesheet branches on it in CSS. If those two ever disagree the layout renders
// half in each mode, so app.css names this file in a comment above its media query.

import { signal } from '@preact/signals';

/** 64rem at the default root size. Below this, the mobile layout is the good one. */
export const DESKTOP_MIN_PX = 1024;
export const DESKTOP_QUERY = `(min-width: ${DESKTOP_MIN_PX / 16}rem)`;

/** Pure, so the boundary is testable without a matchMedia to stub. */
export const isDesktopWidth = (px: number): boolean => px >= DESKTOP_MIN_PX;

function initial(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia === 'function') return window.matchMedia(DESKTOP_QUERY).matches;
  return isDesktopWidth(window.innerWidth);
}

export const isDesktop = signal(initial());

if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  // Dragging a window across the boundary reflows the whole shell, so this has to be
  // live rather than read once at load.
  window.matchMedia(DESKTOP_QUERY).addEventListener('change', (e) => {
    isDesktop.value = e.matches;
  });
}
