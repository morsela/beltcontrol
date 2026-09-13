import { describe, it, expect } from 'vitest';
import { LANDMARKS, landmarkFor } from '../src/lib/landmarks.js';
import { toMiles } from '../src/lib/format.js';

describe('LANDMARKS', () => {
  it('is ordered short to long, which the lookup walks in one pass', () => {
    for (let i = 1; i < LANDMARKS.length; i++) {
      expect(LANDMARKS[i]!.km).toBeGreaterThan(LANDMARKS[i - 1]!.km);
    }
  });

  it('carries a positive, finite length for every entry', () => {
    for (const l of LANDMARKS) {
      expect(Number.isFinite(l.km)).toBe(true);
      expect(l.km).toBeGreaterThan(0);
      expect(l.text.length).toBeGreaterThan(0);
    }
  });

  it('reads as a comparison rather than a sentence of its own', () => {
    // Rendered as "1.15 miles today is <text>." — a leading capital or a trailing
    // full stop would put two sentences where there is one. Proper nouns are the
    // reason every entry opens with an article rather than the name itself.
    for (const l of LANDMARKS) {
      expect(l.text.endsWith('.')).toBe(false);
      expect(l.text[0]).toBe(l.text[0]!.toLowerCase());
    }
  });
});

describe('landmarkFor', () => {
  it('says nothing about a distance the pad never reported', () => {
    // The case this exists for: an absent or unverified distance is not kilometres,
    // and comparing it to a bridge would invent a walk.
    expect(landmarkFor(null)).toBeNull();
  });

  it('rejects a non-finite or negative distance rather than ranking it', () => {
    expect(landmarkFor(NaN)).toBeNull();
    expect(landmarkFor(-1)).toBeNull();
  });

  it('reaches nothing at zero, but still names what is first', () => {
    const f = landmarkFor(0);
    expect(f?.reached).toBeNull();
    expect(f?.next).toBe(LANDMARKS[0]);
  });

  it('picks the longest landmark at or under the distance', () => {
    // 1.15 mi is 1.85 km, which clears the Brooklyn Bridge at 1.825 and not the
    // Champs-Élysées at 1.91.
    const f = landmarkFor(1.85);
    expect(f?.reached?.text).toContain('Brooklyn Bridge');
    expect(f?.next?.text).toContain('Champs');
  });

  it('counts a landmark as reached at exactly its own length', () => {
    const bridge = LANDMARKS.find((l) => l.text.includes('Brooklyn'))!;
    expect(landmarkFor(bridge.km)?.reached).toBe(bridge);
  });

  it('runs out of next rather than wrapping round', () => {
    const longest = LANDMARKS[LANDMARKS.length - 1]!;
    const f = landmarkFor(longest.km + 100);
    expect(f?.reached).toBe(longest);
    expect(f?.next).toBeNull();
  });

  it('holds the two published lengths the card was built around', () => {
    // Stated to users as fact, so they are pinned: the Brooklyn Bridge is 1,825 m
    // end to end and the Golden Gate 2,737 m, which are 1.13 and 1.70 miles.
    const brooklyn = LANDMARKS.find((l) => l.text.includes('Brooklyn'))!;
    const golden = LANDMARKS.find((l) => l.text.includes('Golden Gate'))!;
    expect(toMiles(brooklyn.km)).toBeCloseTo(1.13, 2);
    expect(toMiles(golden.km)).toBeCloseTo(1.7, 2);
  });
});
