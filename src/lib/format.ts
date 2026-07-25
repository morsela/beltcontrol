// Display formatting. Ported unchanged from the original app.js — the unit split
// matters: every protocol speaks km/h on the wire, so all state and everything sent
// to the treadmill stays metric. Miles are a display concern only.

export const KM_PER_MILE = 1.609344;
export const toMph = (kmh: number) => kmh / KM_PER_MILE;
export const toKmh = (mph: number) => mph * KM_PER_MILE;

/** 0.2 mph is 0.32 km/h — comfortably inside the 0.5 km/h-per-press safety limit. */
export const MPH_STEP = 0.2;

export const EM_DASH = '—';

const pad2 = (n: number) => String(Math.floor(n)).padStart(2, '0');

/** hh:mm:ss. Null renders as an em dash rather than a fabricated 00:00:00. */
export const fmtTime = (s: number | null | undefined): string =>
  s == null ? EM_DASH : `${pad2(s / 3600)}:${pad2((s % 3600) / 60)}:${pad2(s % 60)}`;

/** Compact duration for summaries: "1h 24m", "18m", "48s". */
export function fmtDuration(s: number | null | undefined): string {
  if (s == null) return EM_DASH;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${pad2(m)}m`;
  if (m > 0) return `${m}m`;
  return `${Math.floor(s)}s`;
}

export const fmt = (
  v: number | null | undefined,
  digits = 0,
  suffix = ''
): string => (v == null ? EM_DASH : `${Number(v).toFixed(digits)}${suffix}`);

export const fmtInt = (v: number | null | undefined): string =>
  v == null ? EM_DASH : Math.round(v).toLocaleString();

export const fmtMph = (kmh: number | null | undefined): string =>
  kmh == null ? EM_DASH : toMph(kmh).toFixed(1);

/** Local YYYY-MM-DD. Deliberately not toISOString(), which is UTC and would file a
 *  late-evening walk under tomorrow. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export const fmtClock = (ms: number): string =>
  new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

export function fmtDayLabel(ms: number): string {
  const today = startOfDay(Date.now());
  const day = startOfDay(ms);
  const diff = Math.round((today - day) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return new Date(ms).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
