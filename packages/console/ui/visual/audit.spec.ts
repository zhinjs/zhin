/**
 * Layout audit gate of the @zhin.js/console-ui gallery (ADR 0063 D20 第 3 条, D21 P1b): every
 * check at 375 / 768 / 1280 / 1920 px in both themes, including open overlays at phone width.
 * Must pass; Console and plugin pages run the same audit in report mode (audit/cli.mjs).
 */
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { AUDIT_THEMES, AUDIT_WIDTHS, auditPage, auditPluginPages, formatAuditReport } from '../audit/index.mjs';

const gallery = pathToFileURL(join(import.meta.dirname, '.out/visual/index.html')).href;

async function open(page: Page, theme: string, width: number, query = '') {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${gallery}?theme=${theme}${query}`);
  await expect(page.getByRole('heading', { name: '组件示例' })).toBeVisible();
}

async function expectClean(page: Page, theme: string, width: number, options?: Parameters<typeof auditPage>[1]) {
  const run = await auditPage(page, options);
  const report = { violations: run.violations.map((violation) => ({ ...violation, theme, width })) };
  expect(run.violations, formatAuditReport(report)).toEqual([]);
}

for (const theme of AUDIT_THEMES) {
  for (const width of AUDIT_WIDTHS) {
    test(`gallery passes the layout audit (${theme}, ${width}px)`, async ({ page }) => {
      await open(page, theme, width);
      await expectClean(page, theme, width);
    });
  }

  test(`reading pages stay within 60rem (${theme}, 1920px)`, async ({ page }) => {
    await open(page, theme, 1920, '&width=reading');
    await expectClean(page, theme, 1920, { checks: ['content-width'] });
  });

  test.describe(`overlays at phone width (${theme})`, () => {
    const overlayChecks = ['bottom-drawer', 'radius', 'shadow', 'spacing', 'type-scale', 'touch-target', 'overflow', 'consistency'];

    test('select list', async ({ page }) => {
      await open(page, theme, 375);
      await page.getByRole('combobox', { name: '筛选' }).click();
      await expect(page.getByRole('option', { name: '已暂停' })).toBeVisible();
      await expectClean(page, theme, 375, { checks: overlayChecks });
    });

    test('「更多」 menu', async ({ page }) => {
      await open(page, theme, 375);
      await page.locator('.console-page-header').getByRole('button', { name: '更多' }).click();
      await expect(page.getByRole('menuitem', { name: '导入' })).toBeVisible();
      await expectClean(page, theme, 375, { checks: overlayChecks });
    });

    test('confirm dialog', async ({ page }) => {
      await open(page, theme, 375);
      await page.getByRole('button', { name: '删除数据' }).click();
      await expect(page.getByRole('dialog', { name: '删除订阅数据？' })).toBeVisible();
      await expectClean(page, theme, 375, { checks: overlayChecks });
    });
  });
}

test('the audit reports what it checks (self-test)', async ({ page }) => {
  await open(page, 'light', 375);
  await page.evaluate(() => {
    const content = document.querySelector('[data-slot=page-content]')!;
    const bad = document.createElement('div');
    bad.innerHTML = `
      <p style="font-size: 15px; font-weight: 700; padding: 5px; border: 3px solid; border-radius: 7px; box-shadow: 0 1px 3px red">刻意违规的说明文字，用来检查审计本身</p>
      <p>刻意违规的说明文字，用来检查审计本身</p>
      <button style="width: 20px; height: 20px; outline: none">x</button>
      <div data-slot="card" style="box-shadow: 0 1px 2px black">card</div>
      <div style="position: fixed; z-index: 99; top: 0; left: 0">overlay</div>
      <div style="width: 600px">wide</div>
      <p style="color: #ddd">淡得几乎看不见的文字内容示例</p>
      <p data-zhin-ui-ignore="spacing: self-test exemption" style="padding: 5px">exempted</p>`;
    content.append(bad);
  });
  // The injected button sits after the whole gallery: tab far enough to reach it.
  const run = await auditPage(page, { maxFocusSteps: 120 });
  const checks = new Set(run.violations.map((violation) => violation.check));
  for (const check of ['type-scale', 'spacing', 'radius', 'border', 'shadow', 'static-card', 'touch-target', 'overflow', 'shell-overlap', 'duplicate-text', 'contrast', 'focus-visible']) {
    expect(checks, `${check} is reported`).toContain(check);
  }
  expect(run.exemptions).toContainEqual(expect.objectContaining({ check: 'spacing', reason: 'self-test exemption' }));
});

test('auditPluginPages mounts a hand-written page and reports exemptions', async () => {
  test.setTimeout(120_000);
  const directory = join(import.meta.dirname, 'fixtures/sample-plugin');
  const result = await auditPluginPages({
    repoRoot: join(import.meta.dirname, '../../../..'),
    widths: [375, 1280],
    themes: ['light', 'dark'],
    plugins: [{ plugin: 'fixtures/sample-plugin', directory, packageName: 'sample-plugin', pages: [{ name: 'index', entry: 'pages/index/index.tsx' }] }],
  });
  expect(result.pages).toHaveLength(1);
  const [page] = result.pages;
  expect(page.mounted).toBe(true);
  expect(page.violations, JSON.stringify(page.violations, null, 2)).toEqual([]);
  expect(page.exemptions).toContainEqual(expect.objectContaining({ check: 'spacing', reason: '夹具：故意的尺度外内边距，用来验证豁免' }));
});
