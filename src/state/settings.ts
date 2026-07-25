import { signal, effect } from '@preact/signals';

const KEY = 'wp.settings.v1';

export interface Settings {
  /** Daily walking goal, in minutes. */
  goalMinutes: number;
  /** Speed preset chips, in mph — desk walkers live at two or three fixed speeds. */
  presetsMph: number[];
  /** Which metric the hero shows. Persisted so it survives a reload. */
  heroMetric: 'time' | 'distance' | 'steps' | 'kcal';
  /** Last target speed, in km/h. The old app reset this to 2.0 on every load. */
  targetKmh: number;
}

const DEFAULTS: Settings = {
  goalMinutes: 60,
  presetsMph: [1.2, 2.0, 3.0],
  heroMetric: 'time',
  // 1.0 km/h is 0.6 mph: the speed a walking pad moves off at by itself, and the
  // slowest the app will drive one. Starting anywhere else means the first press of
  // Start is a speed change nobody asked for.
  targetKmh: 1.0,
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings = signal<Settings>(load());

effect(() => {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings.value));
  } catch {
    /* private mode / quota — the app still works, it just forgets */
  }
});

export function updateSettings(patch: Partial<Settings>) {
  settings.value = { ...settings.value, ...patch };
}
