import { doStop, doPause, canPause } from '../state/connection.js';

/**
 * While the belt is moving, Stop is pinned above the tab bar and can never be
 * scrolled away. Esc still works too — Stop is the one control that must always
 * be reachable.
 *
 * Pause sits beside it only on units that have a real one, and only ever beside it:
 * it takes a third of the bar to Stop's two, so the button you reach for in a hurry
 * is still the bigger, redder one in the same place it always is.
 */
export function StopBar() {
  return (
    <div class="stopbar">
      <div class="stopbar-inner">
        {canPause.value && (
          <button class="btn" onClick={() => void doPause()}>
            Pause
          </button>
        )}
        <button class="btn danger" onClick={() => void doStop()}>
          Stop
        </button>
      </div>
    </div>
  );
}
