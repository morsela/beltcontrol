import type { Route } from '../app.js';

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

export function TabBar({ route }: { route: Route }) {
  return (
    <nav class="tabbar" aria-label="Sections">
      {TABS.map((t) => (
        <a
          key={t.route}
          href={`#/${t.route}`}
          aria-current={route === t.route ? 'page' : undefined}
        >
          {t.icon}
          <span>{t.label}</span>
        </a>
      ))}
    </nav>
  );
}
