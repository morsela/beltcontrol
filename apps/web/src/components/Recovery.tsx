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
      <h1 class="page">Something went wrong</h1>
      <p class="page-sub">
        The app ran into an error it couldn&rsquo;t recover from. Nothing was sent
        anywhere and the treadmill wasn&rsquo;t affected, but if the belt is moving, stop
        it with the treadmill&rsquo;s own controls or remote.
      </p>

      <div class="card">
        <p class="note" style="margin-top:0">{message}</p>
      </div>

      <div class="card">
        <button class="btn block" onClick={onRetry}>
          Try again
        </button>
        <p class="note" style="margin-top:.6rem">
          Worth a try. If it was a one-off glitch, this is all it takes.
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
          Saves everything this browser has stored for the app, exactly as it is, so it
          works even if that data is what&rsquo;s causing the problem. Save a copy before
          you clear anything.
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
          Deletes every walk recorded in this browser, plus your goal and presets. This
          can&rsquo;t be undone, so download a copy first.
        </p>
      </div>
    </main>
  );
}
