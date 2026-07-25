import { describe, it, expect } from 'vitest';
import { isMobileDevice } from '../src/lib/platform.js';

const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const IPAD =
  'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const WIN_CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

describe('isMobileDevice', () => {
  it('trusts the client hint over the UA string', () => {
    expect(isMobileDevice({ userAgent: WIN_CHROME, userAgentData: { mobile: true } })).toBe(true);
    expect(isMobileDevice({ userAgent: ANDROID, userAgentData: { mobile: false } })).toBe(false);
  });

  it('detects phones and tablets from the UA when no hint is available', () => {
    expect(isMobileDevice({ userAgent: IPHONE })).toBe(true);
    expect(isMobileDevice({ userAgent: IPAD })).toBe(true);
    expect(isMobileDevice({ userAgent: ANDROID })).toBe(true);
  });

  it('leaves desktop browsers alone', () => {
    expect(isMobileDevice({ userAgent: WIN_CHROME })).toBe(false);
    expect(isMobileDevice({ userAgent: MAC, maxTouchPoints: 0 })).toBe(false);
  });

  it('catches iPadOS Safari, which reports a Mac UA', () => {
    expect(isMobileDevice({ userAgent: MAC, maxTouchPoints: 5 })).toBe(true);
  });
});
