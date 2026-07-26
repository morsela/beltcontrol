import { useEffect, useState } from 'preact/hooks';
import { odometerCells } from '../lib/odometer.js';

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

/**
 * A number on mechanical wheels: each digit is a strip of 0–9 behind a one-digit
 * window, moved by transform.
 *
 * It is the odometer on a machine, which is what the thing on the other end of the
 * Bluetooth link is. The behaviour that earns it is the roll — a walk in progress
 * feeds the lifetime total, so the last wheel turns over while you are on the belt
 * rather than the number simply being different the next time you look. Watching a
 * mile land is the point.
 *
 * Every wheel starts at zero and rolls to its digit on the first frame after mount,
 * so arriving at the screen shows the counter arriving at its number. The cells are
 * built from the real value throughout, so nothing reflows as it settles.
 *
 * The wheels are `aria-hidden` and the value is given once as text: ten digits per
 * wheel is ninety characters of noise to a screen reader, for a number it can state
 * in four. Reduced motion needs nothing here — these are CSS transitions, which
 * `tokens.css` already collapses.
 */
export function Odometer({ text, label }: { text: string; label: string }) {
  const [rolled, setRolled] = useState(false);

  useEffect(() => {
    let settled = false;
    const go = () => {
      if (settled) return;
      settled = true;
      setRolled(true);
    };
    // A frame late, deliberately: set in the same paint as the initial render, the
    // transition has nothing to interpolate from and the wheels snap.
    const frame = requestAnimationFrame(go);
    // And a timer behind it, because rAF does not fire at all in a background tab.
    // Without this the wheels stay on the value they were seeded with — zero — while
    // the text beside them reads the real total, which is the screen contradicting
    // itself. Whichever lands first wins; the other is cancelled.
    const timer = window.setTimeout(go, 250);
    return () => {
      settled = true;
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, []);

  const cells = odometerCells(text);

  return (
    <span class="odo tnum">
      <span class="sr-only">{label}</span>
      <span class="odo-wheels" aria-hidden="true">
        {cells.map((cell, i) =>
          cell.kind === 'fixed' ? (
            // Same box as a wheel, so the group separator and the decimal mark sit on
            // the digits' baseline rather than on the surrounding text's.
            <span class="odo-cell odo-fixed" key={`f${i}`}>
              {cell.char}
            </span>
          ) : (
            <span class="odo-cell odo-wheel" key={`w${i}`}>
              <span
                class="odo-strip"
                style={`transform:translateY(calc(${
                  rolled ? -cell.value : 0
                } * var(--odo-step)));transition-delay:${i * 40}ms`}
              >
                {DIGITS.map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </span>
            </span>
          )
        )}
      </span>
    </span>
  );
}
