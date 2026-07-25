/**
 * Mobile / tablet detection for the desktop-only notice.
 *
 * Kept as a pure function over a minimal probe so it is testable without a real
 * navigator, and so the UA string is read in exactly one place.
 */

export interface PlatformProbe {
  userAgent: string;
  /** iPadOS Safari reports a desktop UA; touch points are the only tell. */
  maxTouchPoints?: number;
  /** Chromium hint, authoritative when present — no UA sniffing needed. */
  userAgentData?: { mobile?: boolean };
}

const MOBILE_UA = /Android|iPhone|iPod|iPad|Windows Phone|BlackBerry|Opera Mini|Mobile Safari/i;

export function isMobileDevice(probe: PlatformProbe): boolean {
  // Client Hints first: Chrome, Edge and Samsung Internet all expose it, and it is
  // set by the browser rather than guessed from a string every vendor lies in.
  const hint = probe.userAgentData?.mobile;
  if (typeof hint === 'boolean') return hint;

  if (MOBILE_UA.test(probe.userAgent)) return true;

  // iPadOS 13+ Safari claims to be a Mac. A Mac never reports more than one touch
  // point, so this catches the iPad without also catching a touchscreen laptop
  // (those report a Windows or Linux UA).
  return /Macintosh/.test(probe.userAgent) && (probe.maxTouchPoints ?? 0) > 1;
}

/** Reads the live navigator. Safe to call at module scope in a browser. */
export function isMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  return isMobileDevice(navigator as unknown as PlatformProbe);
}
