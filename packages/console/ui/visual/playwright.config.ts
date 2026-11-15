import { defineConfig } from '@playwright/test';

/**
 * Visual regression of the @zhin.js/console-ui gallery (ADR 0063 决策 1 第 6 条): light and dark.
 * Run after `pnpm --filter @zhin.js/console-ui build`:
 *   pnpm --filter @zhin.js/console-ui test:visual
 * With a preinstalled Chromium of another revision, point PLAYWRIGHT_CHROMIUM_EXECUTABLE at it.
 * Baselines depend on the fonts of the machine that rendered them; refresh with --update-snapshots.
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
