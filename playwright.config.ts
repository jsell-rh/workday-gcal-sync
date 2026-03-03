import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  use: {
    headless: false,
  },
  projects: [
    {
      name: 'extension',
      testMatch: '**/*.spec.ts',
    },
  ],
});
