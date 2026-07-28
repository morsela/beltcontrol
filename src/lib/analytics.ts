/**
 * Product analytics behind a seam.
 *
 * Nothing in the app talks to a vendor directly: callers emit named events through
 * `trackEvent`, and whatever provider is installed (see `analytics-vercel.ts`, wired
 * in `main.tsx`) forwards them. Swapping vendors — or turning analytics off — is one
 * provider file and one line at the entry point, not a sweep through every call site.
 *
 * Two rules the registry below enforces by construction:
 *
 * Nothing identifying goes out. Device names arrive over the air from whatever the pad
 * advertises and can name a person's flat as easily as a product; they stay out, as
 * does every raw telemetry value. Protocol ids, error *names* (never messages — a
 * DOMException message can quote the device), and coarse rounded counts only.
 *
 * Nothing high-frequency goes out. A speed nudge fires on every stepper press and a
 * hero re-render happens every second; per-press events would be volume without
 * information. Events mark decisions and outcomes, not motion.
 */

export type AnalyticsProps = Record<string, string | number | boolean | null>;

export interface AnalyticsProvider {
  /** Fire-and-forget: implementations must not assume anyone awaits or handles errors. */
  track(name: string, props?: AnalyticsProps): void;
}

/**
 * Every event the app can emit, in one place, so the schema is reviewable at a glance
 * and a renamed event is a compile error at its call sites rather than a silent fork
 * in the dashboard. `undefined` marks events that carry no properties.
 */
export interface AnalyticsEvents {
  /** Hash navigation between the three screens. The initial load is the vendor's
   *  ordinary page view; this covers movement the URL bar alone cannot show. */
  route_viewed: { route: string };
  ambient_entered: undefined;

  // --- connection funnel: attempted → connected, or cancelled/failed ---------
  connect_attempted: { filtered: boolean };
  /** Backed out of the device chooser — not a failure, but the funnel step where
   *  "no compatible pad nearby" shows up. */
  connect_cancelled: undefined;
  connect_failed: { reason: string };
  belt_connected: { protocol: string };
  disconnected: { by: 'user' | 'device' };

  // --- belt commands and what the belt did about them ------------------------
  belt_start: { kind: 'start' | 'resume' };
  belt_stop: undefined;
  belt_pause: undefined;
  /** Command written, belt never reported movement. Confirmed starts are `belt_start`
   *  minus these. `refused` separates a pad that answered no to every retry from one
   *  that said nothing at all — the two failure modes some units are known for.
   *  `childLock` is whether the pad had reported its lock engaged, which is how often
   *  the lock actually explains these — the hypothesis the hint in the UI rests on. */
  start_unconfirmed: { kind: 'start' | 'resume'; refused: boolean; childLock: boolean };
  stop_unconfirmed: { kind: 'stop' | 'pause' };
  /** Unit answered pause with "op code not supported" and was stopped instead. */
  pause_rejected: undefined;
  /** Belt stopped without being asked — safety window, key pulled, its own panel. */
  belt_self_stopped: undefined;
  /** The write itself failed, so the command never reached the belt. */
  control_failed: { command: 'start' | 'resume' | 'stop' | 'pause' | 'speed'; reason: string };

  // --- sessions and data ------------------------------------------------------
  session_recorded: { minutes: number; protocol: string | null };
  session_deleted: undefined;
  data_exported: { format: 'backup' | 'csv' };
  backup_imported: { added: number; duplicate: number; skipped: number };
  backup_import_failed: undefined;

  // --- settings ---------------------------------------------------------------
  goal_changed: { minutes: number };
  hero_metric_changed: { metric: string };

  // --- the screen of last resort ---------------------------------------------
  recovery_shown: undefined;
  storage_cleared: undefined;
}

let provider: AnalyticsProvider | null = null;

/** Install the active provider, or `null` to drop events. Tests and anything else
 *  importing instrumented modules run with no provider and emit nothing. */
export function setAnalyticsProvider(p: AnalyticsProvider | null) {
  provider = p;
}

/**
 * Emit one event. Never throws: this is called from the belt control path, and a
 * vendor outage or ad-blocked script must not be able to take Stop down with it.
 */
export function trackEvent<K extends keyof AnalyticsEvents>(
  name: K,
  ...props: AnalyticsEvents[K] extends undefined ? [] : [AnalyticsEvents[K]]
): void {
  try {
    provider?.track(name, props[0] as AnalyticsProps | undefined);
  } catch {
    /* analytics is never worth an error the user can see */
  }
}
