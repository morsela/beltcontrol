import { historyUnsaved } from '../state/session.js';

/**
 * Says that walks are not reaching storage, for as long as that is true.
 *
 * Not dismissible, unlike the desktop notice beside it: that one is advice, and this is
 * a walk being lost at the next reload. It goes away by itself when a write lands.
 *
 * `role="alert"` rather than `status`, for the same reason. It appears mid-walk, most
 * likely while nobody is looking at this tab, and it is the only notice the app has
 * that something already recorded is about to stop existing.
 */
export function StorageNotice() {
  if (!historyUnsaved.value) return null;

  return (
    <div class="banner" role="alert">
      <div class="banner-body">
        <strong>Your walks aren&rsquo;t being saved</strong>
        <p>
          This browser&rsquo;s storage for Belt Control is full or blocked, so anything
          recorded since will be gone when this tab closes. Open{' '}
          <a href="#/history">History</a> and export a backup now &mdash; it still holds
          everything.
        </p>
      </div>
    </div>
  );
}
