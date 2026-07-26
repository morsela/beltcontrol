import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  setAnalyticsProvider,
  trackEvent,
  type AnalyticsProvider,
} from '../src/lib/analytics.js';

/**
 * The seam matters more than the vendor: `trackEvent` sits in the belt control path
 * (start, stop, the failure branches of both), so its contract is that it can never
 * be the thing that throws — with no provider, with a broken one, with any of them.
 */
describe('analytics seam', () => {
  afterEach(() => setAnalyticsProvider(null));

  it('is a no-op without a provider — the default for tests and anything headless', () => {
    expect(() => trackEvent('belt_stop')).not.toThrow();
  });

  it('hands the event name and properties to the installed provider', () => {
    const track = vi.fn();
    setAnalyticsProvider({ track });
    trackEvent('belt_connected', { protocol: 'ftms' });
    trackEvent('belt_stop');
    expect(track).toHaveBeenCalledWith('belt_connected', { protocol: 'ftms' });
    expect(track).toHaveBeenCalledWith('belt_stop', undefined);
  });

  it('swallows a provider that throws — an ad-blocked vendor must not take Stop down', () => {
    const broken: AnalyticsProvider = {
      track() {
        throw new Error('script blocked');
      },
    };
    setAnalyticsProvider(broken);
    expect(() => trackEvent('belt_stop')).not.toThrow();
  });

  it('stops emitting once the provider is uninstalled', () => {
    const track = vi.fn();
    setAnalyticsProvider({ track });
    setAnalyticsProvider(null);
    trackEvent('belt_stop');
    expect(track).not.toHaveBeenCalled();
  });
});
