import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';

const gallery = pathToFileURL(join(import.meta.dirname, '.out/visual/index.html')).href;

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      // Fixed 「today」 for the calendar (the gallery's dates are 2026-11-16).
      await page.clock.setFixedTime(new Date(2026, 10, 16, 10, 0, 0));
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

    test('date-time picker', async ({ page }) => {
      await page.getByRole('button', { name: '开始时间' }).click();
      const grid = page.getByRole('grid', { name: '2026年11月' });
      await expect(grid).toBeVisible();
      await expect(page.getByRole('textbox', { name: '时' })).toHaveValue('09');
      await expect(page).toHaveScreenshot(`datetime-${theme}.png`);
    });

    test('date picker works from the keyboard and clears', async ({ page }) => {
      const trigger = page.getByRole('button', { name: '日期', exact: true });
      await trigger.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('grid', { name: '2026年11月' })).toBeVisible();
      await expect(page.locator('[data-date="2026-11-16"]')).toBeFocused();
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('PageDown');
      await expect(page.getByRole('grid', { name: '2026年12月' })).toBeVisible();
      await page.keyboard.press('Enter');
      await expect(trigger).toHaveText('2026-12-23');
      await expect(trigger).toBeFocused();
      await page.keyboard.press('Delete');
      await expect(trigger).toHaveText('选择日期');
    });

    test('mouse interaction leaves no focus ring (ADR 0063 D32)', async ({ page }) => {
      const ringed = () => page.evaluate(() => [...document.querySelectorAll(':focus-visible')]
        .filter((element) => !(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement))
        .map((element) => element.outerHTML.slice(0, 80)));
      await page.locator('.console-page-header').getByRole('button', { name: '更多' }).click();
      await page.getByRole('menuitem', { name: '清空记录' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.getByRole('dialog').getByRole('button', { name: '关闭' }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(await ringed()).toEqual([]);
      await page.getByRole('combobox', { name: '筛选' }).click();
      await page.getByRole('option', { name: '已暂停' }).click();
      expect(await ringed()).toEqual([]);
      await page.getByRole('button', { name: '日期', exact: true }).click();
      await page.locator('[data-date="2026-11-18"]').click();
      expect(await ringed()).toEqual([]);
      // The keyboard still gets its ring.
      await page.keyboard.press('Tab');
      expect((await ringed()).length).toBe(1);
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
