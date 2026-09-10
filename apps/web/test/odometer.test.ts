import { describe, it, expect } from 'vitest';
import { odometerCells, lifetimeHeadline, fmtOdometer } from '../src/lib/odometer.js';
import type { LifetimeTotals } from '../src/state/session.js';
import { KM_PER_MILE } from '../src/lib/format.js';

const totals = (over: Partial<LifetimeTotals> = {}): LifetimeTotals => ({
  minutes: 0,
  distKm: 0,
  walks: 0,
  days: 0,
  excluded: 0,
  since: null,
  ...over,
});

describe('odometerCells', () => {
  it('marks digits as wheels and leaves everything else fixed', () => {
    expect(odometerCells('40.5')).toEqual([
      { kind: 'digit', value: 4 },
      { kind: 'digit', value: 0 },
      { kind: 'fixed', char: '.' },
      { kind: 'digit', value: 5 },
    ]);
  });

  it('keeps a group separator fixed whatever character the locale uses', () => {
    // Driven off the formatted string, not the number, so a locale grouping with a
    // space or an apostrophe needs no knowledge of that here.
    for (const sep of [',', '.', ' ', ' ', "'"]) {
      const cells = odometerCells(`1${sep}234`);
      expect(cells[1]).toEqual({ kind: 'fixed', char: sep });
      expect(cells.filter((c) => c.kind === 'digit')).toHaveLength(4);
    }
  });

  it('gives one cell per character, so nothing reflows as the wheels settle', () => {
    for (const text of ['0.0', '9.9', '123.4', '12,345.6']) {
      expect(odometerCells(text)).toHaveLength([...text].length);
    }
  });

  it('handles an empty string without inventing a wheel', () => {
    expect(odometerCells('')).toEqual([]);
  });
});

describe('lifetimeHeadline', () => {
  it('counts miles when any protocol reported a distance in real units', () => {
    const h = lifetimeHeadline(totals({ distKm: KM_PER_MILE * 12, minutes: 600 }));
    expect(h.unit).toBe('mi');
    expect(h.value).toBeCloseTo(12);
    expect(h.fellBack).toBe(false);
  });

  it('counts hours rather than showing 0.0 miles over a history it cannot scale', () => {
    // The failure this exists to prevent: hundreds of 0x1234 walks, every distance
    // excluded from the total, and an odometer confidently reading zero miles.
    const h = lifetimeHeadline(totals({ distKm: 0, minutes: 90, excluded: 40 }));
    expect(h.unit).toBe('h');
    expect(h.value).toBeCloseTo(1.5);
    expect(h.fellBack).toBe(true);
  });

  it('counts hours without an explanation when no distance was ever reported at all', () => {
    // Nothing was excluded here — the protocol simply carries no distance field, so
    // there is nothing to account for.
    const h = lifetimeHeadline(totals({ distKm: 0, minutes: 120, excluded: 0 }));
    expect(h.unit).toBe('h');
    expect(h.fellBack).toBe(false);
  });

  it('reads zero on an empty history rather than throwing', () => {
    expect(lifetimeHeadline(totals())).toEqual({ value: 0, unit: 'h', fellBack: false });
  });
});

describe('fmtOdometer', () => {
  it('always carries one decimal, so the last wheel is the one that turns often', () => {
    expect(fmtOdometer(0)).toBe(fmtOdometer(0.0));
    expect(fmtOdometer(4)).toMatch(/^4[.,]0$/);
    expect(fmtOdometer(12.34)).toMatch(/^12[.,]3$/);
  });

  it('groups thousands, so a long-running total stays readable', () => {
    // Locale-agnostic: what matters is that a separator appears, not which one.
    expect(fmtOdometer(12345.6).replace(/[\d]/g, '')).toHaveLength(2);
  });
});
