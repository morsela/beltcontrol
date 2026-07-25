import type { Route } from '../app.js';
import { Brand } from './Logo.js';

const TABS: { route: Route; label: string; icon: preact.JSX.Element }[] = [
  {
    route: 'now',
    label: 'Now',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" stroke-linecap="round" />
      </svg>
    ),
  },
  {
    route: 'today',
    label: 'Today',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <rect x="3" y="5" width="18" height="16" rx="3" />
        <path d="M8 3v4M16 3v4M3 10h18" stroke-linecap="round" />
      </svg>
    ),
  },
  {
    route: 'history',
    label: 'History',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" stroke-linecap="round" />
      </svg>
    ),
  },
];

/**
 * Bottom thumb bar on a phone; a top bar on desktop.
 *
 * The desktop variant drops `Now`, because on desktop Now is not a destination —
 * it is the rail, always on screen. A nav entry for something already visible is a
 * control that cannot report a state.
 */
export function TabBar({ route, variant = 'bottom' }: { route: Route; variant?: 'bottom' | 'top' }) {
  const tabs = variant === 'top' ? TABS.filter((t) => t.route !== 'now') : TABS;

  return (
    <nav class={`tabbar ${variant}`} aria-label="Sections">
      <div class="tabbar-inner">
        {variant === 'top' && <Brand class="wordmark" />}
        {tabs.map((t) => (
          <a
            key={t.route}
            href={`#/${t.route}`}
            aria-current={route === t.route ? 'page' : undefined}
          >
            {t.icon}
            <span>{t.label}</span>
          </a>
        ))}
      </div>
    </nav>
  );
}
