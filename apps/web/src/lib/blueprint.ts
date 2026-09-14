// The scale the fun-fact blueprint is drawn at.
//
// The drawing under the fun fact puts two lengths side by side: the walk, as a
// dimension line across the full width of the sheet, and the landmark it was compared
// to, drawn beneath it at the same scale. That is the whole point of the drawing — a
// bridge is a thing you can picture, and a bridge drawn at a third of today's walk says
// "three of these" without printing a "3×" nobody measured.
//
// A pure ratio breaks down at the bottom of the list. "Another one" cycles back
// through every landmark already passed, and against a marathon the Millennium Bridge
// is under one percent of the width: a bridge one pixel wide is not a bridge. Below a
// floor the landmark is drawn at the floor and the walk's dimension line carries a
// break mark instead, which is what a draughtsman does with a length too long for the
// sheet. The mark is the drawing's own admission that it stopped being to scale, and
// the component's accessible label says the same in words.

/** The least of the sheet a landmark is drawn across, as a fraction of the walk. */
export const MIN_LANDMARK_FRACTION = 0.3;

export interface BlueprintScale {
  /** How much of the walk's width the landmark is drawn across, 0–1. */
  fraction: number;
  /** True when the walk had to be foreshortened to keep the landmark legible. */
  broken: boolean;
}

/**
 * Where the landmark's right-hand end falls, as a fraction of the walk's.
 *
 * The card only draws a landmark the walk has reached, so the true ratio is at most 1;
 * a longer landmark is clamped rather than overflowing the sheet, so a caller that
 * breaks that rule gets a full-width drawing and not a broken layout.
 */
export function blueprintScale(distKm: number, landmarkKm: number): BlueprintScale {
  if (!(distKm > 0) || !(landmarkKm > 0) || !Number.isFinite(distKm)) {
    return { fraction: 1, broken: false };
  }
  const ratio = Math.min(1, landmarkKm / distKm);
  if (ratio < MIN_LANDMARK_FRACTION) return { fraction: MIN_LANDMARK_FRACTION, broken: true };
  return { fraction: ratio, broken: false };
}
