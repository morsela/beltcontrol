// Turning a distance into something with a size you can picture.
//
// "1.15 mi" is a number almost nobody has a feel for, and it is the figure this app
// spends the most pixels on after the day's minutes. The fun-fact card restates it as
// a thing — a bridge, a street, a park — that a reader can stand at one end of.
//
// Two rules hold this to the same standard as every other number on screen:
//
//   1. It never introduces a figure of its own. The distance compared is the distance
//      already stated on the page, converted for display by the same fmtMiles every
//      other mile figure goes through.
//   2. It only ever speaks about a figure the connected pad actually reports. A pad
//      whose distance scale this project never established sends a number that is not
//      kilometres; comparing it to a bridge would dress an unknown quantity up as one.
//      Callers pass `null` in that case and get `null` back — the card does not render.
//
// The lengths below are the published ones, in kilometres because that is what the
// wire and the store speak; the display conversion happens at the edge, as everywhere
// else. Each is a full end-to-end length rather than a span or a deck, because that is
// the thing a person would say they had walked.

/**
 * How the blueprint under the card draws a landmark. Seven silhouettes for fourteen
 * entries: the drawing is there to give the length a shape, and a suspension bridge
 * looks like a suspension bridge whichever harbour it crosses.
 *
 *   suspension  two towers and a cable, in elevation
 *   arch        one arch over a deck, in elevation
 *   street      two kerbs and a centre line, in plan
 *   loop        a circuit, in plan, with a start mark
 *   park        a walled rectangle with trees, in plan
 *   island      a tapered outline, in plan
 *   route       a winding line from a start to a finish
 */
export type LandmarkShape =
  | 'suspension'
  | 'arch'
  | 'street'
  | 'loop'
  | 'park'
  | 'island'
  | 'route';

/** Every shape the blueprint knows how to draw, for the test that pins the list. */
export const LANDMARK_SHAPES: readonly LandmarkShape[] = [
  'suspension',
  'arch',
  'street',
  'loop',
  'park',
  'island',
  'route',
] as const;

/** One comparable thing, and how long it is. */
export interface Landmark {
  km: number;
  /** Reads after "is": "1.15 mi is **the Brooklyn Bridge, end to end**." */
  text: string;
  /** What the blueprint draws it as. */
  shape: LandmarkShape;
}

/**
 * Ordered short to long. Kept deliberately small: every entry is a factual claim this
 * app makes to its users, so the list is one that can be checked rather than one that
 * is long. Anything under about a third of a kilometre is left out — a walk shorter
 * than that has not really started, and the comparisons get silly.
 */
export const LANDMARKS: readonly Landmark[] = [
  { km: 0.325, text: 'the Millennium Bridge in London, end to end', shape: 'suspension' },
  { km: 0.545, text: 'once around the outside of the Colosseum', shape: 'loop' },
  { km: 0.93, text: 'the Mall, from Trafalgar Square to Buckingham Palace', shape: 'street' },
  { km: 1.149, text: 'the Sydney Harbour Bridge, end to end', shape: 'arch' },
  { km: 1.81, text: 'the Royal Mile in Edinburgh, top to bottom', shape: 'street' },
  { km: 1.825, text: 'the Brooklyn Bridge, end to end', shape: 'suspension' },
  { km: 1.91, text: 'the Champs-Élysées, end to end', shape: 'street' },
  { km: 2.1, text: 'the Hollywood Walk of Fame, end to end', shape: 'street' },
  { km: 2.737, text: 'the Golden Gate Bridge, end to end', shape: 'suspension' },
  { km: 4.02, text: 'the length of Central Park, south gate to north gate', shape: 'park' },
  { km: 6.8, text: 'the Las Vegas Strip, end to end', shape: 'street' },
  { km: 9.65, text: 'the full loop road around Central Park', shape: 'loop' },
  { km: 21.6, text: 'the length of Manhattan, tip to tip', shape: 'island' },
  { km: 42.195, text: 'a marathon', shape: 'route' },
] as const;

export interface LandmarkFact {
  /** The longest landmark this distance has covered, or null before the first one. */
  reached: Landmark | null;
  /** The next one up, or null once the list is exhausted. */
  next: Landmark | null;
}

/**
 * The landmark a distance has reached, and the one after it.
 *
 * `null` for a distance that is absent or untrustworthy — the two cases the card must
 * stay silent for. A distance of zero is not an error, it is a day that has not
 * started: `reached` is null and `next` is the first entry, which is the card saying
 * what the first thing to aim at is.
 */
export function landmarkFor(distKm: number | null): LandmarkFact | null {
  if (distKm == null || !Number.isFinite(distKm) || distKm < 0) return null;

  let reached: Landmark | null = null;
  let next: Landmark | null = null;
  for (const l of LANDMARKS) {
    if (l.km <= distKm) reached = l;
    else {
      next = l;
      break;
    }
  }
  return { reached, next };
}
