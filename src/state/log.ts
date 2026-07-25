import { signal } from '@preact/signals';

export type LogKind = '' | 'ok' | 'err';
export interface LogLine {
  id: number;
  t: string;
  msg: string;
  kind: LogKind;
}

const MAX_LINES = 400;

export const logLines = signal<LogLine[]>([]);

/**
 * Latest thing worth saying about the connection. Carried by the status chip,
 * which shows it only when it is an error — the chip already names every normal
 * state in its own words, so a standing line repeating "ready" or "connected"
 * beside it was noise. Empty until something happens.
 */
export const status = signal<{ text: string; kind: LogKind }>({
  text: '',
  kind: '',
});

let seq = 0;

export function log(msg: string, kind: LogKind = '') {
  const t = new Date().toTimeString().slice(0, 8);
  const next = [...logLines.value, { id: seq++, t, msg, kind }];
  logLines.value = next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
}

export function setStatus(text: string, kind: LogKind = '') {
  status.value = { text, kind };
}

/** Log and surface the same message — the original app.js `fail()`. */
export function fail(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  log(msg, 'err');
  setStatus(msg, 'err');
}

export function clearLog() {
  logLines.value = [];
}
