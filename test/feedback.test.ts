import { describe, it, expect } from 'vitest';
import { SUPPORT_EMAIL } from '../src/lib/links.js';
import {
  MAILTO_LIMIT,
  diagnosticLines,
  fitMailto,
  mailtoUrl,
  renderReport,
  subjectFor,
  type ReportInput,
} from '../src/lib/feedback.js';

const ENV = {
  appVersion: '1.0.0',
  userAgent: 'Mozilla/5.0 (Macintosh) Chrome/140.0.0.0',
  bluetooth: true,
  protocol: 'KingSmith 0x1234',
  device: 'KS-C2',
  beltState: 'running (3)',
  firmware: 'MCU 0005, module 0014',
  speedRange: '1.0–6.0 km/h',
  sessionCount: 12,
};

const logOf = (n: number) => Array.from({ length: n }, (_, i) => `12:00:0${i % 10}  line ${i}`);

const report = (over: Partial<ReportInput> = {}): ReportInput => ({
  message: 'The belt will not start.',
  diagnostics: diagnosticLines(ENV),
  log: logOf(6),
  ...over,
});

describe('diagnosticLines', () => {
  it('says "not connected" rather than leaving a field blank', () => {
    const lines = diagnosticLines({ ...ENV, protocol: null, device: null, beltState: null });
    expect(lines).toContain('Device: not connected');
    expect(lines).toContain('Protocol: none — not connected');
    expect(lines).toContain('Belt state: —');
  });

  it('carries the firmware the pad reported, and an em dash when it never said', () => {
    // The first question behind "my model behaves differently" — answered in the
    // report itself instead of over a round trip.
    expect(diagnosticLines(ENV)).toContain('Firmware: MCU 0005, module 0014');
    expect(diagnosticLines({ ...ENV, firmware: null })).toContain('Firmware: —');
  });

  it('reports whether the browser has Web Bluetooth at all', () => {
    // The first question behind "Connect does nothing", and the one answer the user
    // cannot look up themselves.
    expect(diagnosticLines({ ...ENV, bluetooth: false })).toContain(
      'Web Bluetooth: not available in this browser'
    );
  });

  it('carries a session count, never a session', () => {
    const text = diagnosticLines(ENV).join('\n');
    expect(text).toContain('Sessions stored: 12');
    expect(text).not.toMatch(/distKm|speedKmh|samples/);
  });
});

describe('renderReport', () => {
  it('leads with the message, then diagnostics, then the log', () => {
    const text = renderReport(report());
    expect(text.indexOf('The belt will not start.')).toBe(0);
    expect(text.indexOf('--- diagnostics ---')).toBeLessThan(text.indexOf('--- protocol log'));
  });

  it('omits both sections when the user declined to share them', () => {
    const text = renderReport(report({ diagnostics: null, log: [] }));
    expect(text).not.toContain('---');
    expect(text.trim()).toBe('The belt will not start.');
  });

  it('says so rather than sending a blank first line', () => {
    expect(renderReport(report({ message: '   ' }))).toContain('(no message)');
  });

  it('keeps the newest lines when trimming, and says how many it dropped', () => {
    // A failure is at the end of a log. The handshake that scrolled off is in the
    // protocol docs; the last four lines are nowhere else.
    const text = renderReport(report({ log: logOf(30) }), 4);
    expect(text).toContain('--- protocol log (last 4 of 30 lines');
    expect(text).toContain('line 29');
    expect(text).not.toContain('line 25');
  });

  it('does not claim a trim it did not make', () => {
    expect(renderReport(report({ log: logOf(6) }), 99)).toContain('--- protocol log (6 lines) ---');
  });
});

describe('mailtoUrl', () => {
  it('addresses support and encodes both fields', () => {
    const url = mailtoUrl('Belt Control feedback — KS-C2', 'a & b\nc');
    expect(url.startsWith(`mailto:${SUPPORT_EMAIL}?`)).toBe(true);
    expect(url).toContain('subject=Belt%20Control%20feedback%20%E2%80%94%20KS-C2');
    expect(url).toContain('body=a%20%26%20b%0Ac');
  });

  it('names the pad in the subject only when there is one', () => {
    expect(subjectFor('KS-C2')).toBe('Belt Control feedback — KS-C2');
    expect(subjectFor(null)).toBe('Belt Control feedback');
  });
});

describe('fitMailto', () => {
  it('sends the whole report when it fits, and reports no trim', () => {
    const r = report();
    const f = fitMailto(subjectFor('KS-C2'), r);
    expect(f.url).toBe(mailtoUrl(subjectFor('KS-C2'), renderReport(r)));
    expect(f).toMatchObject({ logShown: 6, logTotal: 6, messageTruncated: false });
  });

  it('drops the oldest log lines until the URL fits, and admits the count', () => {
    // 400 lines is the log's own ceiling; nothing near that survives a mailto.
    const f = fitMailto(subjectFor('KS-C2'), report({ log: logOf(400) }));
    expect(f.url.length).toBeLessThanOrEqual(MAILTO_LIMIT);
    expect(f.logTotal).toBe(400);
    expect(f.logShown).toBeGreaterThan(0);
    expect(f.logShown).toBeLessThan(400);
    expect(f.messageTruncated).toBe(false);
    expect(decodeURIComponent(f.url)).toContain('line 399');
  });

  it('measures the encoded URL, not the text it was built from', () => {
    // Every newline triples on the way into a URL. Measured raw, a 400-line log would
    // be declared to fit and then arrive cut in half by the mail client instead.
    const f = fitMailto(subjectFor(null), report({ log: logOf(200) }));
    expect(f.url.length).toBeLessThanOrEqual(MAILTO_LIMIT);
    expect(decodeURIComponent(f.url).length).toBeGreaterThan(f.url.length / 2);
  });

  it('spends what is left on the log rather than shortening the message', () => {
    // The typed sentence is the part support cannot reconstruct, so a message long
    // enough to crowd out the log crowds it out — down to a handful of lines here,
    // and to none at all if it grows further.
    const f = fitMailto(subjectFor(null), report({ message: 'x'.repeat(1200), log: logOf(50) }));
    expect(f.url.length).toBeLessThanOrEqual(MAILTO_LIMIT);
    expect(f.logShown).toBeLessThan(5);
    expect(f.logTotal).toBe(50);
    expect(f.messageTruncated).toBe(false);
    expect(decodeURIComponent(f.url)).toContain('x'.repeat(1200));
  });

  it('gives the log up entirely before it touches the message', () => {
    // The order matters more than any single boundary: as the message grows the log
    // only ever shrinks, and the message is never cut while a log line is still
    // riding along — the report degrades in one direction, not two.
    const fits = [200, 600, 1000, 1200, 1400, 1600].map((n) =>
      fitMailto(subjectFor(null), report({ message: 'x'.repeat(n), log: logOf(50) }))
    );

    fits.forEach((f, i) => {
      expect(f.url.length).toBeLessThanOrEqual(MAILTO_LIMIT);
      if (i > 0) expect(f.logShown).toBeLessThanOrEqual(fits[i - 1]!.logShown);
      if (f.messageTruncated) expect(f.logShown).toBe(0);
    });
    expect(fits.at(-1)!.logShown).toBe(0);
  });

  it('marks the cut when even the message alone is too long', () => {
    const f = fitMailto(subjectFor(null), report({ message: 'y'.repeat(9000), log: [] }));
    expect(f.url.length).toBeLessThanOrEqual(MAILTO_LIMIT);
    expect(f.messageTruncated).toBe(true);
    expect(decodeURIComponent(f.url)).toContain('[…truncated to fit a mail link]');
  });

  it('never returns an unusable URL for an empty report', () => {
    const f = fitMailto(subjectFor(null), { message: '', diagnostics: null, log: [] });
    expect(f.url).toBe(mailtoUrl('Belt Control feedback', '(no message)\n'));
  });
});
