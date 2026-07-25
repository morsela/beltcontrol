import { doStop } from '../state/connection.js';

/**
 * While the belt is moving, Stop is pinned above the tab bar and can never be
 * scrolled away. Esc still works too — Stop is the one control that must always
 * be reachable.
 */
export function StopBar() {
  return (
    <div class="stopbar">
      <div class="stopbar-inner">
        <button class="btn danger" onClick={() => void doStop()}>
          Stop
        </button>
      </div>
    </div>
  );
}
