import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `installId()` reads localStorage, and the drivers decode DataViews the way a
    // browser hands them over — the same reasons the app's suite runs in jsdom.
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
    restoreMocks: true,
  },
});
