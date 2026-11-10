import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  unitsForLocale,
  fmtSpeed,
  fmtDist,
  toSpeed,
  fromSpeed,
  speedUnit,
  distUnit,
  distNoun,
  speedStep,
  EM_DASH,
} from '../src/lib/format.js';
import { metricUnit, metricValue } from '../src/lib/metrics.js';
import { lifetimeHeadline } from '../src/lib/odometer.js';
import { sanitizeSettings, settings, updateSettings } from '../src/state/settings.js';
import { driver, nudgeSpeed } from '../src/state/connection.js';
import { simulatedDriver } from '@beltcontrol/belt-drivers/simulator';

describe('unitsForLocale', () => {
  it('reads miles for the places that walk in them', () => {
    for (const l of ['en-US', 'en-GB', 'en', 'es-US', 'my-MM']) {
      expect(unitsForLocale(l), l).toBe('imperial');
    }
  });

  it('reads kilometres everywhere else', () => {
    for (const l of ['de-DE', 'de', 'fr', 'en-AU', 'en-CA', 'zh-CN', 'ja', 'pt-BR']) {
      expect(unitsForLocale(l), l).toBe('metric');
    }
  });

  it('falls back to what the app always showed when there is no locale to read', () => {
    expect(unitsForLocale(undefined)).toBe('imperial');
    expect(unitsForLocale('not a locale')).toBe('imperial');
  });
});

describe('formatting in the chosen unit', () => {
  it('leaves a metric speed as the wire sent it', () => {
    expect(fmtSpeed(4, 'metric')).toBe('4.0');
    expect(fmtSpeed(4, 'imperial')).toBe('2.5');
    expect(fmtSpeed(null, 'metric')).toBe(EM_DASH);
  });

  it('leaves a metric distance in kilometres', () => {
    expect(fmtDist(1.609344, 'metric')).toBe('1.61');
    expect(fmtDist(1.609344, 'imperial')).toBe('1.00');
    expect(fmtDist(null, 'metric')).toBe(EM_DASH);
  });

  it('round-trips a speed through either unit', () => {
    for (const u of ['metric', 'imperial'] as const) {
      expect(fromSpeed(toSpeed(3.2, u), u)).toBeCloseTo(3.2, 10);
    }
  });

  it('names its units', () => {
    expect([speedUnit('metric'), distUnit('metric'), distNoun('metric')]).toEqual(['km/h', 'km', 'kilometres']);
    expect([speedUnit('imperial'), distUnit('imperial'), distNoun('imperial')]).toEqual(['mph', 'mi', 'miles']);
  });

  it('never steps further than the 0.5 km/h a press is allowed', () => {
    expect(fromSpeed(speedStep('metric'), 'metric')).toBeLessThanOrEqual(0.5);
    expect(fromSpeed(speedStep('imperial'), 'imperial')).toBeLessThanOrEqual(0.5);
  });

  it('captions and fills the hero distance in the chosen unit', () => {
    const day = { key: 'k', date: 0, minutes: 30, distKm: 2.5, steps: 0, kcal: 0, excluded: 0 };
    expect(metricUnit('distance', 'metric')).toBe('km today');
    expect(metricValue('distance', day, 'metric')).toBe('2.50');
    expect(metricUnit('steps', 'metric')).toBe('steps today');
  });

  it('counts the odometer in kilometres for a metric walker', () => {
    const t = { minutes: 600, distKm: 42, walks: 10, days: 5, excluded: 0, since: 1 };
    expect(lifetimeHeadline(t, 'metric')).toEqual({ value: 42, unit: 'km', fellBack: false });
    expect(lifetimeHeadline({ ...t, distKm: 0 }, 'metric').unit).toBe('h');
  });
});

describe('units as a setting', () => {
  it('accepts the two units and nothing else', () => {
    expect(sanitizeSettings({ units: 'metric' })).toEqual({ units: 'metric' });
    expect(sanitizeSettings({ units: 'imperial' })).toEqual({ units: 'imperial' });
    expect(sanitizeSettings({ units: 'furlongs' })).toEqual({});
    expect(sanitizeSettings({ units: null })).toEqual({});
  });

  it('keeps only usable metric presets', () => {
    expect(sanitizeSettings({ presetsKmh: [2, 'x', -1, 4.5] })).toEqual({ presetsKmh: [2, 4.5] });
    expect(sanitizeSettings({ presetsKmh: [] })).toEqual({});
  });

  describe('on load', () => {
    const KEY = 'wp.settings.v1';
    const load = async () => {
      vi.resetModules();
      return (await import('../src/state/settings.js')).settings.value;
    };

    afterEach(() => {
      vi.restoreAllMocks();
      localStorage.clear();
    });

    it('takes a first visit’s units from the browser’s locale', async () => {
      localStorage.clear();
      vi.spyOn(navigator, 'language', 'get').mockReturnValue('de-DE');
      expect((await load()).units).toBe('metric');
    });

    it('leaves a browser that has only ever seen miles in miles', async () => {
      // Settings written before there was a choice: no `units` key in them at all.
      localStorage.setItem(KEY, JSON.stringify({ goalMinutes: 45 }));
      vi.spyOn(navigator, 'language', 'get').mockReturnValue('de-DE');
      const s = await load();
      expect(s.units).toBe('imperial');
      expect(s.goalMinutes).toBe(45);
    });

    it('honours a stored choice over the locale', async () => {
      localStorage.setItem(KEY, JSON.stringify({ units: 'metric' }));
      vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US');
      expect((await load()).units).toBe('metric');
    });
  });
});

describe('stepping the speed in the chosen unit', () => {
  beforeEach(() => {
    driver.value = simulatedDriver({ id: 'ftms' });
    updateSettings({ targetKmh: 2.0 });
  });

  afterEach(() => {
    driver.value = null;
    updateSettings({ units: 'imperial', targetKmh: 1.0 });
  });

  it('moves half a km/h a press in metric', async () => {
    updateSettings({ units: 'metric' });
    await nudgeSpeed(1);
    expect(settings.value.targetKmh).toBe(2.5);
    await nudgeSpeed(-1);
    await nudgeSpeed(-1);
    expect(settings.value.targetKmh).toBe(1.5);
  });

  it('still moves 0.2 mph a press in imperial', async () => {
    updateSettings({ units: 'imperial' });
    await nudgeSpeed(1); // 1.2 mph -> 1.4 mph
    expect(settings.value.targetKmh).toBe(2.3);
  });
});
