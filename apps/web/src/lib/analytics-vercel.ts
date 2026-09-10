/**
 * The Vercel Analytics provider — the only file that knows which vendor is in use.
 * Replacing the vendor means replacing this file and the one `setAnalyticsProvider`
 * call in `main.tsx`; the event registry and every call site stay put.
 *
 * `track` queues internally until the script injected by `<Analytics />` (see
 * `app.tsx`) has loaded, so events fired early are not lost.
 */
import { track } from '@vercel/analytics';
import type { AnalyticsProvider } from './analytics.js';

export const vercelAnalytics: AnalyticsProvider = {
  track(name, props) {
    track(name, props);
  },
};
