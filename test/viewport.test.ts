import { describe, it, expect } from 'vitest';
import { isDesktopWidth, DESKTOP_MIN_PX, DESKTOP_QUERY } from '../src/lib/viewport.js';

describe('isDesktopWidth', () => {
  it('puts phones and narrow side-by-side windows on the mobile layout', () => {
    expect(isDesktopWidth(390)).toBe(false); // iPhone
    expect(isDesktopWidth(768)).toBe(false); // tablet portrait
    expect(isDesktopWidth(1023)).toBe(false); // half of a 2048px screen, near miss
  });

  it('switches to the two-column shell at the breakpoint and above', () => {
    expect(isDesktopWidth(DESKTOP_MIN_PX)).toBe(true);
    expect(isDesktopWidth(1440)).toBe(true);
    expect(isDesktopWidth(2560)).toBe(true);
  });

  it('states the breakpoint in rem, matching the media query in app.css', () => {
    // The JS branch and the CSS branch must agree or the page renders half in each
    // mode. app.css names this file above its @media block for the same reason.
    expect(DESKTOP_QUERY).toBe('(min-width: 64rem)');
    expect(DESKTOP_MIN_PX).toBe(1024);
  });
});
