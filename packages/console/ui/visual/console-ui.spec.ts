import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const gallery = pathToFileURL(join(import.meta.dirname, '.out/visual/index.html')).href;

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`${gallery}?theme=${theme}`);
      await expect(page.getByRole('heading', { name: '组件示例' })).toBeVisible();
      expect(errors).toEqual([]);
    });

    test('page shell, buttons, inputs, selects and table', async ({ page }) => {
      // Shell chrome registered through usePageChrome lands in the header.
      await expect(page.locator('.console-page-header').getByText('更新于 09:30:15')).toBeVisible();
      await expect(page.locator('.console-page-header').getByRole('button', { name: '移除订阅' })).toBeVisible();
      await expect(page).toHaveScreenshot(`gallery-${theme}.png`, { fullPage: true });
    });

    test('select menu', async ({ page }) => {
      await page.getByRole('combobox', { name: '筛选' }).click();
      await expect(page.getByRole('option', { name: '已暂停' })).toBeVisible();
      await expect(page).toHaveScreenshot(`select-${theme}.png`);
    });

    test('confirm dialog', async ({ page }) => {
      await page.getByRole('button', { name: '删除数据' }).click();
      const dialog = page.getByRole('dialog', { name: '删除订阅数据？' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', { name: '删除' })).toBeDisabled();
      await expect(page).toHaveScreenshot(`dialog-${theme}.png`);
    });

    test.describe('phone width (375px)', () => {
      test.use({ viewport: { width: 375, height: 812 } });

      test('header actions fold into 「更多」, table rows become cards', async ({ page }) => {
        const header = page.locator('.console-page-header');
        await expect(header.getByRole('button', { name: '新建订阅' })).toBeVisible();
        await expect(header.getByRole('button', { name: '导入' })).toHaveCount(0);
        await expect(header.getByRole('button', { name: '更多' })).toBeVisible();
        await expect(page).toHaveScreenshot(`gallery-mobile-${theme}.png`, { fullPage: true });
      });

      test('select opens as a bottom drawer', async ({ page }) => {
        await page.getByRole('combobox', { name: '筛选' }).click();
        await expect(page.getByRole('option', { name: '已暂停' })).toBeVisible();
        await expect(page).toHaveScreenshot(`select-mobile-${theme}.png`);
      });
    });
  });
}
