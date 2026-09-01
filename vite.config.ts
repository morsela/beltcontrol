/// <reference types="vitest/config" />
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// Stamped into the bundle so a support report can name the build it came from.
// Read here rather than imported, so package.json's dependency list does not end up
// in the app just to carry one string.
const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };

/**
 * Give the service worker a cache name that changes when the build does.
 *
 * sw.js lives in public/ and is copied verbatim, so it cannot read import.meta.env —
 * hence a placeholder rewritten on the way out. The id is derived from the emitted
 * filenames, which Vite content-hashes, so it moves exactly when the output moves and
 * stays identical for an unchanged build.
 *
 * Without this the cache key was a hand-written constant, and sw.js's activate handler
 * (delete every cache that is not VERSION) had nothing to delete on any deploy.
 */
function stampServiceWorker(): Plugin {
  let buildId = 'dev';
  return {
    name: 'stamp-service-worker',
    apply: 'build',
    writeBundle(_options, bundle) {
      buildId = createHash('sha256')
        .update(Object.keys(bundle).sort().join('|'))
        .digest('hex')
        .slice(0, 12);
    },
    // closeBundle, not writeBundle: public/ is copied after the bundle is written, so
    // an earlier hook would stamp a file that is about to be overwritten.
    async closeBundle() {
      const sw = join('dist', 'sw.js');
      try {
        const src = await readFile(sw, 'utf8');
        await writeFile(sw, src.replace('__BUILD_ID__', buildId));
      } catch {
        /* no sw.js in this build */
      }
    },
  };
}

/**
 * Date-stamp `<lastmod>` in the sitemap at build time.
 *
 * A hand-written date is a date that is wrong from the second commit onwards, and a wrong
 * `lastmod` is worse than none — a crawler that finds one stale learns to ignore the field
 * on this host. The commit date is the honest answer: it is exactly when the content last
 * changed, and it cannot drift from what was deployed.
 *
 * `%cs` is the committer date as a bare `YYYY-MM-DD`, which is a legal W3C datetime and
 * the only precision a sitemap needs. Falls back to the build date where git is not around
 * — a shallow clone, or a tarball.
 */
function stampSitemap(): Plugin {
  return {
    name: 'stamp-sitemap',
    apply: 'build',
    // closeBundle for the same reason as the service worker: public/ is copied after the
    // bundle is written, so an earlier hook would stamp a file about to be overwritten.
    async closeBundle() {
      let date: string;
      try {
        date = execFileSync('git', ['log', '-1', '--format=%cs'], { encoding: 'utf8' }).trim();
      } catch {
        date = new Date().toISOString().slice(0, 10);
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) date = new Date().toISOString().slice(0, 10);

      const sitemap = join('dist', 'sitemap.xml');
      try {
        const src = await readFile(sitemap, 'utf8');
        // Only inside the element. A bare replaceAll also rewrote the placeholder where
        // the file's own comment names it, which left the deployed sitemap explaining
        // that "2026-08-31 is stamped with the last commit date" — the one copy of the
        // explanation anybody reads is the deployed one.
        await writeFile(
          sitemap,
          src.replaceAll('<lastmod>__LASTMOD__</lastmod>', `<lastmod>${date}</lastmod>`)
        );
      } catch {
        /* no sitemap in this build */
      }
    },
  };
}

// No plugin needed for Preact: oxc handles the JSX transform via tsconfig's
// jsxImportSource. Keeping the plugin list to the two local ones above — nothing
// installed — keeps `npm install` to four packages.
export default defineConfig({
  plugins: [stampServiceWorker(), stampSitemap()],
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  define: { __APP_VERSION__: JSON.stringify(version) },
  resolve: {
    // Lets any stray `react` import resolve to Preact rather than failing the build.
    alias: {
      react: 'preact/compat',
      'react-dom': 'preact/compat',
    },
  },
  server: {
    // http://localhost and http://127.0.0.1 both count as secure contexts, so Web
    // Bluetooth works here without TLS. file:// does not.
    host: '127.0.0.1',
    port: 8080,
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    // session.ts touches localStorage and window.setInterval at import time, and the
    // drivers decode DataViews the way the browser hands them over.
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
    restoreMocks: true,
  },
});
