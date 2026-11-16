import { defineConfig } from '@playwright/test';

/**
 * @zhin.js/console-ui gallery in a real browser. Run after `pnpm --filter @zhin.js/console-ui build`:
 *   pnpm --filter @zhin.js/console-ui test:visual   visual regression (console-ui.spec.ts), light and dark
 *   pnpm --filter @zhin.js/console-ui test:audit    layout audit gate (audit.spec.ts, ADR 0063 D20)
 * With a preinstalled Chromium of another revision, point PLAYWRIGHT_CHROMIUM_EXECUTABLE at it.
 * Baselines depend on the fonts of the machine that rendered them; refresh with --update-snapshots
 * and review every changed image.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  outputDir: './.out/test-results',
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  globalSetup: './global-setup.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['github'], ['line']] : 'line',
  expect: {
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.002 },
  },
  use: {
    browserName: 'chromium',
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    locale: 'zh-CN',
    launchOptions: executablePath ? { executablePath } : {},
  },
});
