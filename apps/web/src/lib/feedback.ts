/**
 * Feedback to support, composed in the browser and handed to the user's own mail app.
 *
 * There is no server to post to. The app ships as static files, `connect-src` is
 * `'self'`, and the standing promise is that nothing about a walk leaves the browser
 * unless the person using it sends it. A `mailto:` keeps that promise literally true:
 * the report is assembled here, shown in full before it goes, and the user's mail
 * client is what actually transmits it — so it can be read, edited or abandoned on the
 * way out. Nothing is sent in the background, and there is nothing to consent to.
 *
 * The cost is length. A `mailto:` is a URL, and URLs go through the OS shell, which
 * stops carrying them somewhere around 2 KB — so a long protocol log will not fit in
 * the mail and has to travel as an attachment the user saves and attaches. Everything
 * here exists to make that trim visible rather than silent: a log that was quietly
 * cut in half is worse than no log, because the missing half is where the bug was.
 */

import { SUPPORT_EMAIL } from './links.js';

/**
 * Characters of `mailto:` URL to aim under.
 *
 * The real ceiling is the operating system's, not the app's: the Windows shell caps a
 * command line at 2048 characters and Chrome's external-protocol handoff is no more
 * generous. Past it the behaviour is not an error — the mail client opens with the
 * body silently truncated, or does not open at all. 1800 leaves room for whatever the
 * mailer prepends and keeps this side of every handler that was tested.
 */
export const MAILTO_LIMIT = 1800;

/** What the app knows about itself and the pad, as plain values, so this file needs
 *  no signals and can be tested without a browser. */
export interface DiagEnv {
  appVersion: string;
  userAgent: string;
  /** Whether this browser exposes Web Bluetooth at all — the first question behind
   *  "the Connect button does nothing". */
  bluetooth: boolean;
  /** Driver the probe settled on, e.g. `KingSmith 0x1234`. */
  protocol: string | null;
  device: string | null;
  /** Belt-state label and raw code, already formatted by the caller. */
  beltState: string | null;
  /** Firmware identity the pad reported, e.g. "MCU 0005, module 0014" — the first
   *  question behind "my model behaves differently", answered without a round trip. */
  firmware: string | null;
  speedRange: string | null;
  sessionCount: number;
}

/**
 * The technical half of a report: what support would otherwise have to ask for over
 * three round trips. Counts only — no session, no history, no telemetry. A number of
 * stored sessions answers "did my history disappear" without shipping any of it.
 */
export function diagnosticLines(env: DiagEnv): string[] {
  return [
    `App: ${env.appVersion}`,
    `Browser: ${env.userAgent}`,
    `Web Bluetooth: ${env.bluetooth ? 'available' : 'not available in this browser'}`,
    `Protocol: ${env.protocol ?? 'none — not connected'}`,
    `Device: ${env.device ?? 'not connected'}`,
    `Belt state: ${env.beltState ?? '—'}`,
    `Firmware: ${env.firmware ?? '—'}`,
    `Speed range: ${env.speedRange ?? '—'}`,
    `Sessions stored: ${env.sessionCount}`,
  ];
}

export interface ReportInput {
  message: string;
  /** `null` when the user chose not to share diagnostics. */
  diagnostics: string[] | null;
  /** The complete log, newest last. What actually gets rendered is bounded by
   *  `logShown`; the count in the header is always the true one. */
  log: string[];
}

const PLACEHOLDER = '(no message)';

/** The last `n` items, tolerating an `n` beyond either end. */
function tail<T>(items: T[], n: number): T[] {
  if (n >= items.length) return items;
  return n <= 0 ? [] : items.slice(items.length - n);
}

/**
 * The report as the recipient will read it. Plain text: it is going into an email
 * body, where anything else would arrive as markup.
 *
 * `logShown` trims from the top, keeping the newest lines — a failure is at the end
 * of a log, and the connect handshake that scrolled off is reconstructible from the
 * protocol docs while the last four lines are not.
 */
export function renderReport(input: ReportInput, logShown = Infinity): string {
  const blocks: string[] = [input.message.trim() || PLACEHOLDER];

  if (input.diagnostics && input.diagnostics.length > 0) {
    blocks.push(['--- diagnostics ---', ...input.diagnostics].join('\n'));
  }

  const total = input.log.length;
  const shown = tail(input.log, logShown);
  if (shown.length > 0) {
    // Says why the rest is missing rather than promising an attachment that only
    // exists if the user went and saved one.
    const head =
      shown.length < total
        ? `--- protocol log (last ${shown.length} of ${total} lines — a mail link cannot carry the rest) ---`
        : `--- protocol log (${total} line${total === 1 ? '' : 's'}) ---`;
    blocks.push([head, ...shown].join('\n'));
  }

  return `${blocks.join('\n\n')}\n`;
}

/** Names the pad in the subject when there is one, so a protocol report can be
 *  triaged without opening it. */
export function subjectFor(device: string | null): string {
  return device ? `Belt Control feedback — ${device}` : 'Belt Control feedback';
}

export function mailtoUrl(subject: string, body: string, to = SUPPORT_EMAIL): string {
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export interface FittedMailto {
  url: string;
  /** How many log lines the mail actually carries. */
  logShown: number;
  logTotal: number;
  /** True when the message itself had to be cut — only reachable by typing more than
   *  a full URL's worth of prose, and worth saying out loud when it happens. */
  messageTruncated: boolean;
}

/**
 * The longest `mailto:` that still fits, and an honest account of what was dropped
 * to get there.
 *
 * Length is measured on the encoded URL, not on the text: a newline costs three
 * characters once encoded, so a log measured raw would overshoot by roughly its own
 * line count. Log lines go first and the typed message goes last — the sentence
 * explaining the problem is the part support cannot reconstruct.
 */
export function fitMailto(
  subject: string,
  input: ReportInput,
  limit = MAILTO_LIMIT
): FittedMailto {
  const total = input.log.length;
  const build = (logShown: number, message = input.message) =>
    mailtoUrl(subject, renderReport({ ...input, message }, logShown));

  const whole = build(total);
  if (whole.length <= limit) {
    return { url: whole, logShown: total, logTotal: total, messageTruncated: false };
  }

  // Largest line count that fits. Binary search rather than a walk: 400 lines is the
  // log's ceiling and each probe re-renders the whole report.
  let lo = 0;
  let hi = total;
  let best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (build(mid).length <= limit) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (best > 0 || build(0).length <= limit) {
    return { url: build(best), logShown: best, logTotal: total, messageTruncated: false };
  }

  // Even with no log at all it does not fit, so the message is the thing that is too
  // long. Cut it to the longest prefix that does, and mark the cut in the text so the
  // reader knows a sentence is missing rather than guessing at a typo.
  const marker = ' […truncated to fit a mail link]';
  let keep = 0;
  lo = 0;
  hi = input.message.length;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (build(0, input.message.slice(0, mid) + marker).length <= limit) {
      keep = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return {
    url: build(0, input.message.slice(0, keep) + marker),
    logShown: 0,
    logTotal: total,
    messageTruncated: true,
  };
}
