import { download, stamped } from '../lib/download.js';

/**
 * The screen of last resort.
 *
 * Session history lives in localStorage, so a render that throws on stored data throws
 * again on the next load, and again after that — the app is bricked for that browser
 * with no way back in short of the devtools. Validation on read (see
 * `sanitizeSession`) closes the case that actually happened; this closes the category.
 *
 * Rescue before repair: the raw stored strings are handed over untouched, without
 * being parsed, so the offer to download them cannot fail the same way the app just
 * did. Clearing is the last button, not the first, and it names what it will destroy.
 */

const KEYS = [
  'wp.sessions.v1',
  'wp.session.open.v1',
  'wp.settings.v1',
  'wp.desktopNotice.dismissed.v1',
];

function rawDump(): string {
  const out: Record<string, string | null> = {};
  for (const k of KEYS) {
    try {
      out[k] = localStorage.getItem(k);
    } catch {
      out[k] = null;
    }
  }
  return JSON.stringify(out, null, 2);
}

export function Recovery({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const message = error instanceof Error ? error.message : String(error);

  return (
    <main class="shell">
      <h1 class="page">Something broke</h1>
      <p class="page-sub">
        The app hit an error it could not recover from on its own. Nothing was sent
        anywhere, and the treadmill is unaffected — if the belt is moving, use its own
        controls or remote to stop it.
      </p>

      <div class="card">
        <p class="note" style="margin-top:0">{message}</p>
      </div>

      <div class="card">
        <button class="btn block" onClick={onRetry}>
          Try again
        </button>
        <p class="note" style="margin-top:.6rem">
          Worth one attempt — if the error came from something transient, this is all it
          takes.
        </p>
      </div>

      <p class="section-title">If it keeps happening</p>
      <div class="card">
        <button
          class="btn block"
          onClick={() => download(stamped('storage-dump', 'json'), rawDump(), 'application/json')}
        >
          Download my stored data
        </button>
        <p class="note" style="margin-top:.6rem">
          The raw contents of this browser's storage, exactly as stored and without being
          interpreted — so this works even when the data is what the app is choking on.
          Keep it before clearing anything.
        </p>
      </div>

      <div class="card">
        <button
          class="btn danger block"
          onClick={() => {
            if (!confirm('Delete all stored walking history and settings from this browser?')) return;
            for (const k of KEYS) {
              try {
                localStorage.removeItem(k);
              } catch {
                /* nothing more to try */
              }
            }
            location.reload();
          }}
        >
          Clear stored data and reload
        </button>
        <p class="note" style="margin-top:.6rem">
          Deletes every walk recorded in this browser along with your goal and presets.
          It cannot be undone — download the copy above first.
        </p>
      </div>
    </main>
  );
}
