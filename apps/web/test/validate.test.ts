import { describe, it, expect } from 'vitest';
import { isObj } from '../src/lib/validate.js';

describe('isObj', () => {
  it('accepts a plain object, which is what every sanitiser needs before reading a field', () => {
    expect(isObj({})).toBe(true);
    expect(isObj({ startedAt: 1 })).toBe(true);
  });

  it('rejects an array — the case the obvious spelling of this guard gets wrong', () => {
    // `typeof [] === 'object'` and `[] !== null`, so a guard written without the
    // Array check waves one through. Every `v.someField` after it then reads undefined
    // rather than failing, and a stored array validates as an object with no fields in
    // it: a settings file that restores nothing, reported as a settings file.
    expect(isObj([])).toBe(false);
    expect(isObj([{ startedAt: 1 }])).toBe(false);
  });

  it('rejects null, which typeof alone calls an object', () => {
    expect(isObj(null)).toBe(false);
  });

  it('rejects the primitives a truncated or hand-edited file can parse to', () => {
    for (const v of [undefined, 0, 1, '', 'nope', true, false]) expect(isObj(v)).toBe(false);
  });
});
