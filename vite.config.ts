/// <reference types="vitest/config" />
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

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

// No plugin needed for Preact: oxc handles the JSX transform via tsconfig's
// jsxImportSource. Keeping the plugin list empty keeps `npm install` to four packages.
export default defineConfig({
  plugins: [stampServiceWorker()],
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
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
