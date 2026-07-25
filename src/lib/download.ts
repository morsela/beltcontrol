import { dayKey } from './format.js';

/** Hand a string to the browser as a file. The object URL is revoked on the next
 *  frame rather than immediately — Safari has not always started the download by
 *  the time `click()` returns. */
export function download(filename: string, text: string, mime: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** `belt-control-sessions-2026-07-24.csv` — sortable, and obvious a year later.
 *  Local date, not UTC: an evening export west of Greenwich would otherwise be
 *  stamped tomorrow, while every day the app shows is a local one. */
export function stamped(base: string, ext: string, at = Date.now()): string {
  return `belt-control-${base}-${dayKey(at)}.${ext}`;
}
