import { signal, computed, effect } from '@preact/signals';
import { HARD_MAX_KMH, HARD_MIN_KMH } from '@beltcontrol/belt-drivers';
import { isObj } from '../lib/validate.js';
import { unitsForLocale, type Units } from '../lib/format.js';
import { STORAGE_KEYS, readJson, writeJson } from '../lib/storage.js';

export interface Settings {
  /** Daily walking goal, in minutes. */
  goalMinutes: number;
  /** Speed preset chips, in mph — desk walkers live at two or three fixed speeds. */
  presetsMph: number[];
  /** The same three chips for a walker in km/h. A list of its own rather than the mph
   *  one converted: 1.2 mph is 1.93 km/h, and nobody's desk speed is 1.9. */
  presetsKmh: number[];
  /** Whether the screen speaks miles or kilometres. Display only — every speed stored
   *  here and sent to the belt is km/h either way. */
  units: Units;
  /** Which metric the hero shows. Persisted so it survives a reload. */
  heroMetric: 'time' | 'distance' | 'steps' | 'kcal';
  /** Last target speed, in km/h. The old app reset this to 2.0 on every load. */
  targetKmh: number;
  /** The advertised name of the last pad a real connection reached, so the connect
   *  panel can offer that pad back by name. Local-only, like everything here — device
   *  names can identify a household, which is why they never leave for analytics. */
  lastDeviceName: string | null;
}

const DEFAULTS: Settings = {
  goalMinutes: 60,
  presetsMph: [1.2, 2.0, 3.0],
  presetsKmh: [2.0, 3.0, 5.0],
  units: 'imperial',
  heroMetric: 'time',
  // 1.0 km/h is 0.6 mph: the speed a walking pad moves off at by itself, and the
  // slowest the app will drive one. Starting anywhere else means the first press of
  // Start is a speed change nobody asked for.
  targetKmh: 1.0,
  lastDeviceName: null,
};

const HERO_METRICS: readonly Settings['heroMetric'][] = ['time', 'distance', 'steps', 'kcal'];

/**
 * Whatever survives validation, as a patch over the current settings.
 *
 * Everything in localStorage is untrusted input — not because an attacker is assumed,
 * but because *this app* wrote it, across versions, possibly interrupted mid-write, and
 * because a backup file lands here too and can be hand-edited. The same argument
 * `sanitizeSession` already makes about the session store, and it applies with more
 * force here: `targetKmh` is not a number on a screen, it is the speed written to a
 * treadmill. Read back with a bare cast, a `null` or a string from a truncated write
 * became NaN, survived the clamp in the connect path — `Math.min(Math.max(NaN, …))` is
 * NaN — and went out on the wire as the speed.
 *
 * Only the keys that validate are returned, so a file missing half its settings leaves
 * the rest of the current ones alone.
 */
export function sanitizeSettings(v: unknown): Partial<Settings> {
  if (!isObj(v)) return {};
  const out: Partial<Settings> = {};

  if (typeof v.goalMinutes === 'number' && Number.isFinite(v.goalMinutes) && v.goalMinutes > 0) {
    out.goalMinutes = Math.round(v.goalMinutes);
  }
  if (Array.isArray(v.presetsMph)) {
    const presets = v.presetsMph.filter(
      (p): p is number => typeof p === 'number' && Number.isFinite(p) && p > 0
    );
    if (presets.length > 0) out.presetsMph = presets;
  }
  if (Array.isArray(v.presetsKmh)) {
    const presets = v.presetsKmh.filter(
      (p): p is number => typeof p === 'number' && Number.isFinite(p) && p > 0
    );
    if (presets.length > 0) out.presetsKmh = presets;
  }
  if (v.units === 'imperial' || v.units === 'metric') out.units = v.units;
  if (typeof v.heroMetric === 'string' && (HERO_METRICS as readonly string[]).includes(v.heroMetric)) {
    out.heroMetric = v.heroMetric as Settings['heroMetric'];
  }
  // Held to the app's own speed envelope, the one every driver is also held to. A stored
  // target is a setpoint the next Start sends, so the bounds that apply to a pad's claims
  // about itself apply to it too.
  if (typeof v.targetKmh === 'number' && Number.isFinite(v.targetKmh) && v.targetKmh > 0) {
    out.targetKmh = Math.min(Math.max(v.targetKmh, HARD_MIN_KMH), HARD_MAX_KMH);
  }
  // Null is a real value here — "no pad remembered" — and distinct from absent.
  if (typeof v.lastDeviceName === 'string' && v.lastDeviceName !== '') {
    out.lastDeviceName = v.lastDeviceName;
  } else if (v.lastDeviceName === null) {
    out.lastDeviceName = null;
  }

  return out;
}

function load(): Settings {
  // Nothing stored, unreadable storage and bytes that are not JSON all arrive here as
  // `undefined`, which `sanitizeSettings` answers with an empty patch — so all three
  // land on the defaults without needing to be told apart.
  const stored = readJson(STORAGE_KEYS.settings);
  return {
    ...DEFAULTS,
    // Units are the one default that depends on who is asking. A browser with nothing
    // stored is a first visit and gets what its locale implies; one with settings from
    // before there was a choice has only ever seen miles, and keeps seeing them until
    // it is told otherwise.
    units: stored === undefined ? localeUnits() : DEFAULTS.units,
    ...sanitizeSettings(stored),
  };
}

function localeUnits(): Units {
  return unitsForLocale(typeof navigator === 'undefined' ? undefined : navigator.language);
}

export const settings = signal<Settings>(load());

effect(() => {
  writeJson(STORAGE_KEYS.settings, settings.value);
});

/** The chosen units, for the many places that only want to format a number. */
export const units = computed(() => settings.value.units);

export function updateSettings(patch: Partial<Settings>) {
  settings.value = { ...settings.value, ...patch };
}
