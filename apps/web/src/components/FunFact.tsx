import { useState } from 'preact/hooks';
import { todayTotals, lifetimeTotals } from '../state/session.js';
import { LANDMARKS, landmarkFor } from '../lib/landmarks.js';
import { fmtMiles } from '../lib/format.js';

/** Longest first, reversed once at module load rather than on every render. */
const LANDMARKS_DESC = [...LANDMARKS].reverse();

/**
 * The one card on Today that is not a measurement.
 *
 * It restates a distance already on the screen as something with a size — a bridge, a
 * street, a park — and adds no figure of its own. Both numbers it prints go through
 * `fmtMiles`, the same conversion every other mile on the page uses, so it cannot
 * disagree with the stat beside it.
 *
 * It renders nothing at all when there is nothing honest to say. A protocol that
 * reports no distance, or one whose distance scale this project never established,
 * leaves the distance out of every aggregate — comparing that to a bridge would be
 * inventing a walk. The card is absent rather than empty: a permanent em dash where a
 * sentence should be is the failure mode the metric tiles were rebuilt to avoid.
 */
export function FunFact() {
  // Today's distance is the subject while there is one. Before the day's first walk
  // there is nothing to compare, so the card falls back to the lifetime total, which
  // is the other distance this app already stands behind — and which makes the card
  // useful on a morning rather than blank until the first mile.
  const day = todayTotals.value.distKm;
  const life = lifetimeTotals.value.distKm;
  const usingDay = day > 0;
  const distKm = usingDay ? day : life;

  const [shown, setShown] = useState(0);

  const fact = landmarkFor(distKm > 0 ? distKm : null);
  // `reached` is null for a distance shorter than the first landmark. There is a
  // `next` in that case, but "you have walked none of the Millennium Bridge" is not a
  // fun fact, so the card waits.
  if (!fact?.reached) return null;

  // Cycling goes back down through the landmarks already passed, which is the only
  // direction that stays true: everything below the one reached has also been walked.
  const passed = LANDMARKS_DESC.filter((l) => l.km <= distKm);
  const pick = passed[shown % passed.length] ?? fact.reached;

  return (
    <div class="funfact">
      <p class="funfact-k">Which is to say</p>
      <p class="funfact-v">
        {fmtMiles(distKm)} miles {usingDay ? 'today' : 'in total'} is {pick.text}.
      </p>
      {fact.next && (
        <p class="funfact-next">
          Next up at {fmtMiles(fact.next.km)} mi: {fact.next.text}.
        </p>
      )}
      {/* Only offered when there is somewhere for it to go. Not instrumented,
          deliberately: the analytics registry is for decisions and outcomes, and
          cycling a card to read the next line of it is neither. */}
      {passed.length > 1 && (
        <button class="table-toggle" onClick={() => setShown((n) => n + 1)}>
          Another one
        </button>
      )}
    </div>
  );
}
