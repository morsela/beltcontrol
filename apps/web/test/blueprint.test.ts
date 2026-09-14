import { describe, it, expect } from 'vitest';
import { blueprintScale, MIN_LANDMARK_FRACTION } from '../src/lib/blueprint.js';
import { LANDMARKS, LANDMARK_SHAPES } from '../src/lib/landmarks.js';

describe('blueprintScale', () => {
  it('draws a landmark at its true share of the walk when it is legible', () => {
    // 1.825 km of bridge against a 3.65 km walk is exactly half the sheet.
    const s = blueprintScale(3.65, 1.825);
    expect(s.fraction).toBeCloseTo(0.5, 6);
    expect(s.broken).toBe(false);
  });

  it('fills the sheet when the walk is exactly the landmark', () => {
    const s = blueprintScale(1.825, 1.825);
    expect(s.fraction).toBe(1);
    expect(s.broken).toBe(false);
  });

  it('never draws a landmark past the walk, even for a caller that breaks the rule', () => {
    // The card only ever draws a landmark the walk has reached; if that rule were
    // broken the drawing should clamp rather than overflow the sheet.
    const s = blueprintScale(1, 2);
    expect(s.fraction).toBe(1);
    expect(s.broken).toBe(false);
  });

  it('holds a tiny landmark at the floor and breaks the walk line instead', () => {
    // "Another one" against a marathon reaches back to the Millennium Bridge, under
    // one percent of the width. That is drawn at the floor with the break mark on.
    const s = blueprintScale(42.195, 0.325);
    expect(s.fraction).toBe(MIN_LANDMARK_FRACTION);
    expect(s.broken).toBe(true);
  });

  it('is to scale right down to the floor, and broken just under it', () => {
    const at = blueprintScale(1, MIN_LANDMARK_FRACTION);
    expect(at.fraction).toBeCloseTo(MIN_LANDMARK_FRACTION, 6);
    expect(at.broken).toBe(false);
    const under = blueprintScale(1, MIN_LANDMARK_FRACTION - 0.001);
    expect(under.fraction).toBe(MIN_LANDMARK_FRACTION);
    expect(under.broken).toBe(true);
  });

  it('falls back to a full-width, unbroken sheet for a distance it cannot scale', () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(blueprintScale(bad, 1)).toEqual({ fraction: 1, broken: false });
    }
    expect(blueprintScale(1, 0)).toEqual({ fraction: 1, broken: false });
  });

  it('keeps the floor low enough that most of the list is to scale against most of it', () => {
    // The floor exists for the far end of the list. If it ever crept up to where the
    // Brooklyn Bridge is broken against a Golden Gate walk, the drawing would be
    // saying "not to scale" about a comparison it could perfectly well draw.
    expect(blueprintScale(2.737, 1.825).broken).toBe(false);
  });
});

describe('LANDMARKS shapes', () => {
  it('gives every landmark a silhouette the blueprint can draw', () => {
    for (const l of LANDMARKS) {
      expect(LANDMARK_SHAPES).toContain(l.shape);
    }
  });

  it('uses every silhouette at least once, so none is dead code', () => {
    for (const shape of LANDMARK_SHAPES) {
      expect(LANDMARKS.some((l) => l.shape === shape)).toBe(true);
    }
  });
});
