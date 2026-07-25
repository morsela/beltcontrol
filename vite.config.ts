/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

// No plugin needed for Preact: esbuild handles the JSX transform via tsconfig's
// jsxImportSource. Keeping the plugin list empty keeps `npm install` to four packages.
export default defineConfig({
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
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
