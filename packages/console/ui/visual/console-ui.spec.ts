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

/** Behaviour in a real browser (no screenshots): themes, focus at limits, toasts, menu focus. */
test.describe('behaviour', () => {
  const rgb = (page: import('@playwright/test').Page, selector: string) =>
    page.evaluate((target) => getComputedStyle(document.querySelector(target)!).backgroundColor, selector);

  test('no theme is light even when the system is dark; data-theme="system" opts in (D38)', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(`${gallery}?theme=light`);
    await expect(page.getByRole('heading', { name: '组件示例' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBeNull();
    expect(await rgb(page, 'body')).toBe('rgb(247, 245, 243)');
    await page.goto(`${gallery}?theme=system`);
    await expect(page.getByRole('heading', { name: '组件示例' })).toBeVisible();
    expect(await rgb(page, 'body')).toBe('rgb(18, 16, 16)');
    await page.emulateMedia({ colorScheme: 'light' });
    expect(await rgb(page, 'body')).toBe('rgb(247, 245, 243)');
  });

  test('dark: utilities follow the nearest theme island', async ({ page }) => {
    const probe = (theme: string, island: string) => page.evaluate(([themeClass, islandClass]) => {
      document.documentElement.classList.toggle('dark', themeClass === 'dark');
      const host = document.createElement('div');
      if (islandClass) host.className = islandClass;
      const span = document.createElement('span');
      span.className = 'bg-sunken dark:bg-danger';
      span.textContent = 'x';
      host.append(span);
      document.body.append(host);
      const color = getComputedStyle(span).backgroundColor;
      host.remove();
      return color;
    }, [theme, island]);
    await page.goto(`${gallery}?theme=light`);
    await expect(page.getByRole('heading', { name: '组件示例' })).toBeVisible();
    expect(await probe('light', '')).toBe('rgb(243, 240, 237)'); // sunken (light)
    expect(await probe('dark', '')).toBe('rgb(255, 122, 138)'); // danger (dark)
    expect(await probe('dark', 'light')).toBe('rgb(243, 240, 237)'); // a .light island in a dark page
    expect(await probe('light', 'dark')).toBe('rgb(255, 122, 138)'); // a .dark island in a light page
  });

  test('Stepper keeps the keyboard focus at its limit', async ({ page }) => {
    await page.goto(`${gallery}?theme=light`);
    const decrease = page.getByRole('group', { name: '每人每天上限' }).getByRole('button', { name: '减少' });
    const value = page.getByRole('group', { name: '每人每天上限' }).locator('output');
    await decrease.focus();
    for (let step = 0; step < 21; step += 1) await page.keyboard.press('Enter');
    await expect(value).toHaveText('0 次');
    await expect(decrease).toBeFocused();
    await expect(decrease).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.press('Enter');
    await expect(value).toHaveText('0 次');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('group', { name: '每人每天上限' }).getByRole('button', { name: '增加' })).toBeFocused();
  });

  test('Toaster: one live region; the time stops while the pointer is on a toast; 「撤销」 stays 5 s', async ({ page }) => {
    await page.clock.install();
    await page.goto(`${gallery}?theme=light`);
    const toaster = page.locator('[data-slot="toaster"]');
    await page.getByRole('button', { name: '停用', exact: true }).click();
    const toast = toaster.locator('[data-slot="toast"]');
    await expect(toast).toHaveCount(1);
    await expect(toaster).toHaveAttribute('aria-live', 'polite');
    await expect(toast).not.toHaveAttribute('role', 'status');
    await expect(toast).not.toHaveAttribute('aria-live');
    // 「撤销」: still there after 2.5 s, gone after 5 s.
    await page.clock.runFor(4000);
    await expect(toast).toHaveCount(1);
    await page.clock.runFor(1100);
    await expect(toast).toHaveCount(0);
    // Hovering stops the time; leaving continues it.
    await page.getByRole('button', { name: '停用', exact: true }).click();
    await expect(toast).toHaveCount(1);
    await toast.hover();
    await page.clock.runFor(20_000);
    await expect(toast).toHaveCount(1);
    await page.mouse.move(0, 0);
    await page.clock.runFor(5100);
    await expect(toast).toHaveCount(0);
    // Focus in the toast stops it too.
    await page.getByRole('button', { name: '停用', exact: true }).click();
    await toast.getByRole('button', { name: '撤销' }).focus();
    await page.clock.runFor(20_000);
    await expect(toast).toHaveCount(1);
  });

  test('menu items: keyboard focus shows the focus ring, the pointer only the fill', async ({ page }) => {
    await page.goto(`${gallery}?theme=light`);
    const more = page.locator('.console-page-header').getByRole('button', { name: '更多' });
    // Pointer: the highlighted item is sunken, without a ring.
    await more.click();
    const item = page.getByRole('menuitem').first();
    await item.hover();
    await expect(item).toHaveAttribute('data-highlighted', '');
    await expect(item).toHaveCSS('background-color', 'rgb(243, 240, 237)');
    await expect(item).toHaveCSS('box-shadow', 'none');
    await page.keyboard.press('Escape');
    // Keyboard: the focused item gets the 2px focus ring (inset) on primary-soft.
    await page.reload();
    await more.focus();
    await page.keyboard.press('Enter');
    await page.mouse.move(0, 0);
    const focused = page.locator('[role="menuitem"]:focus-visible');
    await expect(focused).toHaveCount(1);
    await expect(focused).toHaveCSS('box-shadow', /0px 0px 0px 2px inset/u);
    await expect(focused).toHaveCSS('background-color', 'rgb(239, 236, 233)');
    await page.keyboard.press('Escape');
    // Select lists follow the same rule: opened by the pointer, the selected option has no ring;
    // opened from the keyboard, it has.
    const select = page.getByRole('combobox', { name: '筛选' });
    await select.click();
    await expect(page.getByRole('option', { name: '全部' })).toBeFocused();
    await expect(page.getByRole('option', { name: '全部' })).toHaveCSS('box-shadow', 'none');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('option', { name: '启用中' })).toHaveCSS('box-shadow', /0px 0px 0px 2px inset/u);
    await page.keyboard.press('Escape');
    await select.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('option', { name: '全部' })).toHaveCSS('box-shadow', /0px 0px 0px 2px inset/u);
  });
});
