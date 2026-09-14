import type { JSX } from 'preact';
import type { Landmark, LandmarkShape } from '../lib/landmarks.js';
import { blueprintScale } from '../lib/blueprint.js';
import { fmtMiles } from '../lib/format.js';

/**
 * The drawing pinned to the fun-fact note: the walk and the landmark it was compared
 * to, side by side, as a blueprint.
 *
 * Two dimension lines and one silhouette. The walk runs the full width of the sheet;
 * the landmark is drawn beneath it at the same scale, so a bridge a third as long as
 * the day's distance is a third of the width, and the reader sees "three of these"
 * without the card printing a multiplier nobody measured. The only figures on the
 * sheet are the two lengths, both through `fmtMiles` like every other mile on the page,
 * and the landmark's is one the card already states for the next one up.
 *
 * When a landmark is too short to draw to scale — "Another one" against a marathon
 * reaches back to the Millennium Bridge — it is drawn at a floor and the walk's line
 * carries a break mark, which is a draughtsman's convention for a length cut short.
 * The accessible label says "not to scale" in the same case. See src/lib/blueprint.ts.
 *
 * Blueprint because it is a drawing of something with a length, and a drawing of a
 * length wants dimension lines, and dimension lines want a sheet with a grid and a
 * border. The blue is the reference: it is what a blueprint is.
 */
export function Blueprint({
  landmark,
  distKm,
  width = 320,
}: {
  landmark: Landmark;
  distKm: number;
  /** viewBox width. The note is a third of a column on desktop and the text on the
   *  sheet scales with the box, so the caller hands a narrower one there — the same
   *  arrangement the charts use. */
  width?: number;
}) {
  const W = width;
  const H = 100;
  // Room at each side for the dimension ticks to overhang the object they measure.
  const m = 18;
  const span = W - 2 * m;

  const { fraction, broken } = blueprintScale(distKm, landmark.km);
  const x0 = m;
  const xWalk = m + span;
  const xLand = m + span * fraction;

  const box = { x0, x1: xLand, y0: 30, y1: 66 };

  const walkMi = fmtMiles(distKm);
  const landMi = fmtMiles(landmark.km);
  const label = `${broken ? 'Not to scale' : 'To scale'}: ${walkMi} miles walked against ${
    landmark.text
  }, ${landMi} miles.`;

  return (
    <svg
      class="blueprint"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={label}
      focusable="false"
    >
      <defs>
        <pattern id="bp-grid" width="10" height="10" patternUnits="userSpaceOnUse">
          <path d="M10 0H0V10" fill="none" stroke="currentColor" stroke-width="0.5" opacity="0.22" />
        </pattern>
      </defs>

      {/* The sheet: paper, grid, border. */}
      <rect x="0" y="0" width={W} height={H} rx="3" fill="var(--blueprint-paper)" />
      <rect x="0" y="0" width={W} height={H} rx="3" fill="url(#bp-grid)" />
      <rect x="4.5" y="4.5" width={W - 9} height={H - 9} rx="1.5" fill="none" stroke="currentColor" stroke-width="0.8" />

      <g fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
        {/* The walk, dimensioned across the top. */}
        <Dimension x0={x0} x1={xWalk} y={20} ext={[26, 16]} broken={broken ? xLand + (xWalk - xLand) / 2 : null} />
        {/* The landmark, dimensioned across the bottom. */}
        <Dimension x0={x0} x1={xLand} y={78} ext={[70, 82]} broken={null} />
        <Silhouette shape={landmark.shape} {...box} />
      </g>

      <text class="blueprint-text" x={(x0 + xWalk) / 2} y="14" text-anchor="middle">
        {walkMi} mi
      </text>
      <text class="blueprint-text" x={(x0 + xLand) / 2} y="91" text-anchor="middle">
        {landMi} mi
      </text>
    </svg>
  );
}

/**
 * A dimension line in the architectural idiom: extension lines rising off the object,
 * the measured line between them, and an oblique tick at each end rather than an
 * arrowhead. `ext` is the y the extension lines start at and the y they stop at, so
 * the same element draws the one above the object and the one below it.
 *
 * `broken` is an x at which to cut the line with a break mark, or null.
 */
function Dimension({
  x0,
  x1,
  y,
  ext,
  broken,
}: {
  x0: number;
  x1: number;
  y: number;
  ext: [from: number, to: number];
  broken: number | null;
}): JSX.Element {
  const [from, to] = ext;
  const tick = (x: number) => `M${x - 2.5},${y + 2.5} L${x + 2.5},${y - 2.5}`;
  const line =
    broken == null
      ? `M${x0},${y} H${x1}`
      : // A gap of eight, with a zigzag through it.
        `M${x0},${y} H${broken - 4} l2,-4 4,8 2,-4 H${x1}`;
  return (
    <g>
      <path d={`M${x0},${from} V${to} M${x1},${from} V${to}`} stroke-width="0.8" />
      <path d={line} />
      <path d={`${tick(x0)} ${tick(x1)}`} />
    </g>
  );
}

/**
 * The seven silhouettes, each drawn into a box rather than a fixed viewBox, because
 * the box is as wide as the scale says and a bridge stretched with preserveAspectRatio
 * would stretch its strokes with it. Every one is stroked in the sheet's ink and none
 * is filled, so they recolour with the theme. Detail thins out as the box narrows: a
 * bridge thirty percent of a phone-width sheet has room for three hangers, not five.
 */
function Silhouette({
  shape,
  x0,
  x1,
  y0,
  y1,
}: {
  shape: LandmarkShape;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}): JSX.Element {
  const w = x1 - x0;
  const h = y1 - y0;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const r = (n: number) => n.toFixed(1);
  // A quadratic from (xa, ya) to (xb, yb), sagging or peaking to yMid at its centre.
  const quad = (xa: number, ya: number, xb: number, yb: number, yMid: number) => {
    const cyq = 2 * yMid - (ya + yb) / 2;
    return { d: `Q${r((xa + xb) / 2)},${r(cyq)} ${r(xb)},${r(yb)}`, at: (t: number) => ({
      x: xa + t * (xb - xa),
      y: (1 - t) ** 2 * ya + 2 * t * (1 - t) * cyq + t ** 2 * yb,
    }) };
  };
  const wide = w >= 100;

  switch (shape) {
    case 'suspension': {
      const yd = y1 - 6;
      const xa = x0 + w * 0.24;
      const xb = x1 - w * 0.24;
      const main = quad(xa, y0, xb, y0, yd - 5);
      const hangers = (wide ? [0.2, 0.35, 0.5, 0.65, 0.8] : [0.25, 0.5, 0.75])
        .map((t) => main.at(t))
        .map((p) => `M${r(p.x)},${r(p.y)} V${r(yd)}`)
        .join(' ');
      return (
        <g>
          <path d={`M${r(x0)},${r(yd)} H${r(x1)}`} />
          <path d={`M${r(xa)},${r(y0)} V${r(y1)} M${r(xb)},${r(y0)} V${r(y1)}`} stroke-width="1.6" />
          <path d={`M${r(xa - 2)},${r(y0 + 6)} h4 M${r(xb - 2)},${r(y0 + 6)} h4`} />
          <path d={`M${r(x0)},${r(yd - 1)} L${r(xa)},${r(y0)} ${main.d} L${r(x1)},${r(yd - 1)}`} />
          <path d={hangers} stroke-width="0.8" />
        </g>
      );
    }
    case 'arch': {
      const yd = y1 - 9;
      const inset = w * 0.08;
      const arch = quad(x0 + inset, y1, x1 - inset, y1, y0 + 1);
      const hangers = (wide ? [0.22, 0.36, 0.5, 0.64, 0.78] : [0.3, 0.5, 0.7])
        .map((t) => arch.at(t))
        .map((p) => `M${r(p.x)},${r(p.y)} V${r(yd)}`)
        .join(' ');
      return (
        <g>
          <path d={`M${r(x0)},${r(yd)} H${r(x1)}`} />
          <path d={`M${r(x0 + inset)},${r(y1)} ${arch.d}`} stroke-width="1.6" />
          <path d={hangers} stroke-width="0.8" />
          {/* The pylons at each end. */}
          <path d={`M${r(x0)},${r(y1)} V${r(y0 + 14)} h${r(inset)} V${r(y1)} M${r(x1)},${r(y1)} V${r(y0 + 14)} h${r(-inset)} V${r(y1)}`} />
        </g>
      );
    }
    case 'street': {
      const yk0 = cy - h * 0.16;
      const yk1 = cy + h * 0.16;
      // Building footprints along both kerbs, as many as fit at a fixed pitch, so a
      // longer street has more of them rather than bigger ones.
      const pitch = 14;
      const n = Math.max(1, Math.floor((w - 4) / pitch));
      const lead = (w - n * pitch) / 2 + 2.5;
      const lots: string[] = [];
      for (let i = 0; i < n; i++) {
        const x = x0 + lead + i * pitch;
        lots.push(`M${r(x)},${r(yk0 - 3)} v-7 h9 v7`);
        lots.push(`M${r(x)},${r(yk1 + 3)} v7 h9 v-7`);
      }
      return (
        <g>
          <path d={`M${r(x0)},${r(yk0)} H${r(x1)} M${r(x0)},${r(yk1)} H${r(x1)}`} />
          <path d={`M${r(x0)},${r(cy)} H${r(x1)}`} stroke-width="0.8" stroke-dasharray="4 3" />
          <path d={lots.join(' ')} stroke-width="0.8" />
        </g>
      );
    }
    case 'loop': {
      const rx = w / 2;
      const ry = h / 2 - 1;
      return (
        <g>
          <ellipse cx={r(cx)} cy={r(cy)} rx={r(rx)} ry={r(ry)} />
          <ellipse cx={r(cx)} cy={r(cy)} rx={r(rx - 6)} ry={r(ry - 6)} stroke-width="0.8" />
          {/* The start line, and a chevron on the far side to say which way round. */}
          <path d={`M${r(cx)},${r(cy - ry - 2)} V${r(cy - ry + 8)}`} stroke-width="1.6" />
          <path d={`M${r(cx + rx - 5)},${r(cy + 4)} l4,4 4,-4`} />
        </g>
      );
    }
    case 'park': {
      const trees = wide
        ? [
            [0.1, 0.3], [0.2, 0.72], [0.34, 0.35], [0.46, 0.75], [0.8, 0.3], [0.9, 0.7], [0.74, 0.74],
          ]
        : [[0.15, 0.3], [0.3, 0.72], [0.82, 0.32], [0.86, 0.72]];
      return (
        <g>
          <rect x={r(x0)} y={r(y0 + 3)} width={r(w)} height={r(h - 6)} />
          <rect x={r(x0 + 2)} y={r(y0 + 5)} width={r(w - 4)} height={r(h - 10)} stroke-width="0.6" />
          {/* The reservoir. */}
          <ellipse cx={r(x0 + w * 0.61)} cy={r(cy)} rx={r(w * 0.1)} ry={r(h * 0.18)} stroke-width="0.8" />
          {trees.map(([fx, fy]) => (
            <circle key={`${fx},${fy}`} cx={r(x0 + w * fx!)} cy={r(y0 + h * fy!)} r="2" stroke-width="0.8" />
          ))}
        </g>
      );
    }
    case 'island': {
      // South at the left, coming to a point; north at the right, blunt.
      const outline = [
        `M${r(x0)},${r(cy)}`,
        `C${r(x0 + w * 0.15)},${r(cy - h * 0.22)} ${r(x0 + w * 0.5)},${r(cy - h * 0.5)} ${r(x0 + w * 0.85)},${r(cy - h * 0.42)}`,
        `C${r(x1)},${r(cy - h * 0.32)} ${r(x1)},${r(cy + h * 0.32)} ${r(x0 + w * 0.85)},${r(cy + h * 0.42)}`,
        `C${r(x0 + w * 0.5)},${r(cy + h * 0.5)} ${r(x0 + w * 0.15)},${r(cy + h * 0.22)} ${r(x0)},${r(cy)}`,
        'Z',
      ].join(' ');
      return (
        <g>
          <path d={outline} />
          {/* The avenues, and the park a third of the way up. */}
          <path d={`M${r(x0 + w * 0.12)},${r(cy)} H${r(x0 + w * 0.92)}`} stroke-width="0.6" stroke-dasharray="3 3" />
          <rect x={r(x0 + w * 0.42)} y={r(cy - h * 0.12)} width={r(w * 0.16)} height={r(h * 0.24)} stroke-width="0.8" />
        </g>
      );
    }
    case 'route': {
      const a = h * 0.42;
      const path = [
        `M${r(x0)},${r(cy)}`,
        `C${r(x0 + w * 0.1)},${r(cy - a)} ${r(x0 + w * 0.2)},${r(cy - a)} ${r(x0 + w * 0.3)},${r(cy)}`,
        `S${r(x0 + w * 0.45)},${r(cy + a)} ${r(x0 + w * 0.55)},${r(cy)}`,
        `S${r(x0 + w * 0.7)},${r(cy - a)} ${r(x0 + w * 0.8)},${r(cy)}`,
        `S${r(x0 + w * 0.92)},${r(cy + a * 0.6)} ${r(x1)},${r(cy)}`,
      ].join(' ');
      return (
        <g>
          <path d={path} />
          {/* A start, and a finish line. */}
          <circle cx={r(x0)} cy={r(cy)} r="2.5" />
          <path d={`M${r(x1 - 2)},${r(cy - 6)} V${r(cy + 6)} M${r(x1 + 2)},${r(cy - 6)} V${r(cy + 6)}`} />
        </g>
      );
    }
  }
}
