/**
 * The mark: the belt seen from above, the same three shapes as public/icon.svg.
 *
 * Inline rather than an <img> so it costs no request and scales with whatever
 * header it sits in — and so it cannot flash in late over the wordmark beside it.
 * Keep the geometry in step with public/icon.svg; that file is the favicon and the
 * installed app icon, and a mark that disagrees with the tab is two marks.
 *
 * The two colours are literals, not tokens, because the tile is its own surface:
 * --accent is a dark green under the light theme and would sit on near-black here.
 * Fixed, it reads identically against the light and the dark shell, and matches the
 * icon the browser is already showing.
 */
export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg
      class="logo"
      width={size}
      height={size}
      viewBox="0 0 512 512"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="512" height="512" rx="112" fill="#101418" />
      <rect x="60" y="192" width="392" height="128" rx="64" fill="#3ddc91" />
      <g fill="#101418">
        <rect x="126" y="244" width="68" height="24" rx="12" />
        <rect x="222" y="244" width="68" height="24" rx="12" />
        <rect x="318" y="244" width="68" height="24" rx="12" />
      </g>
    </svg>
  );
}

/**
 * Mark plus name. The name is a heading nowhere — on both layouts it labels the
 * app, not the section under it, and the sections already own the headings.
 */
export function Brand({ class: cls = '' }: { class?: string }) {
  return (
    <span class={`brand${cls ? ` ${cls}` : ''}`}>
      <Logo size={22} />
      Belt Control
    </span>
  );
}
