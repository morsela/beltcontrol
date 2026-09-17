import { useEffect } from 'preact/hooks';
import { download, stamped } from '../lib/download.js';
import { trackEvent } from '../lib/analytics.js';
import { ALL_STORAGE_KEYS, readRaw, removeStored } from '../lib/storage.js';

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

// The key list comes from `lib/storage.ts` rather than being written out again here.
// It used to be a second copy, kept in step by hand — so a fifth stored key added
// anywhere in the app would have gone missing from both the rescue download and the
// clear button below, which are the last two controls that still work once everything
// else has failed.
function rawDump(): string {
  const out: Record<string, string | null> = {};
  // `readRaw` swallows a storage that will not answer and reports it as absent, which
  // is the right reading here: the dump is a record of what could be recovered.
  for (const k of ALL_STORAGE_KEYS) out[k] = readRaw(k);
  return JSON.stringify(out, null, 2);
}

export function Recovery({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const message = error instanceof Error ? error.message : String(error);

  // The one place a crash surfaces, so the one signal that the stored-data guards
  // missed something. Deliberately no properties: the error message can quote
  // whatever stored data caused it.
  useEffect(() => {
    trackEvent('recovery_shown');
  }, []);

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
            // Best effort only — the reload below may outrun the beacon.
            trackEvent('storage_cleared');
            for (const k of ALL_STORAGE_KEYS) removeStored(k);
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
