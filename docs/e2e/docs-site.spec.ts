import { expect, test } from '@playwright/test';

test.describe('documentation site journeys', () => {
  test('collects consented search, 404, and exit insights without URL secrets', async ({ page }) => {
    const insights: Array<Record<string, unknown>> = [];
    // Keep a cold index pending beyond the former fixed polling window.
    let searchIndexRequested = false;
    let releaseSearchIndex!: () => void;
    const searchIndexGate = new Promise<void>((resolve) => { releaseSearchIndex = resolve; });
    // Match both VitePress preview virtual ids (@localSearchIndex…) and
    // hashed build assets that still carry localSearchIndex in the path.
    await page.route(/localSearchIndex/i, async (route) => {
      searchIndexRequested = true;
      await searchIndexGate;
      await route.continue();
    });
    await page.route('**/__docs-insights', async (route) => {
      const payload = route.request().postDataJSON() as Record<string, unknown>;
      insights.push(payload);
      await route.fulfill({ status: 204 });
    });

    await page.goto('/operations/docs-insights?private=secret#verify');
    await expect(page.getByRole('complementary', { name: '帮助改进 Zhin 文档' })).toBeVisible();
    expect(insights).toHaveLength(0);

    await page.getByRole('button', { name: '同意匿名统计' }).click();
    await expect.poll(() => insights.some((event) => event.event === 'page_view')).toBe(true);

    await page.keyboard.press('/');
    const search = page.locator('#localsearch-input');
    await expect(search).toBeVisible();
    await search.fill('qzxwvkjhgfds');
    await expect.poll(() => searchIndexRequested).toBe(true);
    await page.waitForTimeout(2_200);
    expect(insights.filter((event) => String(event.event).startsWith('search'))).toEqual([]);
    // Register before releasing: continue() can finish before waitForResponse attaches.
    const indexSettled = page.waitForResponse(
      (response) => /localSearchIndex/i.test(response.url()) && response.ok(),
      { timeout: 30_000 },
    );
    releaseSearchIndex();
    await indexSettled;
    // VitePress only sets enableNoResults after MiniSearch loads. Re-typing
    // forces debouncedWatch to run against the loaded index if the cold-load
    // watch raced past an empty index.
    await search.fill('');
    await search.fill('qzxwvkjhgfds');
    await expect(page.locator('.VPLocalSearchBox .no-results')).toBeVisible({ timeout: 15_000 });
    await expect.poll(
      () => insights.filter((event) => event.event === 'search_no_results'),
      { timeout: 15_000 },
    ).toEqual([expect.objectContaining({ searchTerm: 'qzxwvkjhgfds', resultCount: 0 })]);

    await search.fill('Docker');
    await expect(page.locator('.VPLocalSearchBox .result').first()).toBeVisible();
    await expect.poll(() => insights.some((event) => (
      event.event === 'search' && event.searchTerm === 'Docker' && Number(event.resultCount) > 0
    ))).toBe(true);

    // Body-only matches have no title highlights; a case edit can leave the
    // entire result DOM unchanged, but it is still a separate search event.
    await search.fill('timeoutMs');
    await expect.poll(() => insights.some((event) => event.searchTerm === 'timeoutMs')).toBe(true);
    const previousResults = await page.locator('.VPLocalSearchBox .result')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    expect(previousResults.length).toBeGreaterThan(0);
    await search.fill('timeoutms');
    await expect.poll(() => insights.filter((event) => event.searchTerm === 'timeoutms'))
      .toEqual([expect.objectContaining({ event: 'search', resultCount: previousResults.length })]);
    expect(await page.locator('.VPLocalSearchBox .result')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')))).toEqual(previousResults);

    await page.goto('/definitely-missing-zhin-document');
    await expect.poll(() => insights.some((event) => event.event === 'not_found')).toBe(true);
    await expect.poll(() => insights.some((event) => event.event === 'page_exit')).toBe(true);
    expect(insights.every((event) => !String(event.path).includes('?') && !String(event.path).includes('#'))).toBe(true);
    expect(JSON.stringify(insights)).not.toContain('private=secret');

    await page.getByRole('button', { name: '文档隐私设置' }).click();
    await page.getByRole('button', { name: '暂不参与' }).click();
    const eventCountAfterOptOut = insights.length;
    await page.goto('/');
    await page.waitForTimeout(600);
    expect(insights).toHaveLength(eventCountAfterOptOut);
  });

  test('serves every deployment template as a direct download', async ({ request }) => {
    const paths = [
      'Dockerfile',
      'docker-compose.yml',
      'dockerignore.txt',
      'env.example.txt',
      'zhin@.service',
      'kubernetes/resources.yaml',
      'kubernetes/kustomization.yaml',
    ];

    for (const path of paths) {
      const response = await request.get(`/deploy/production/${path}`);
      expect(response.ok(), path).toBe(true);
      expect((await response.body()).byteLength, path).toBeGreaterThan(0);
    }
  });

  test('navigates between production operations pages without a full reload', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/operations/production');
    await expect(page.getByRole('heading', { level: 1, name: '把 Zhin 部署成可恢复的服务' }))
      .toBeVisible();
    const navigationMarker = await page.evaluate(() => {
      const marker = crypto.randomUUID();
      Object.assign(window, { __docsNavigationMarker: marker });
      return marker;
    });

    await page.getByRole('link', { name: '版本兼容与迁移' }).first().click();
    await expect(page).toHaveURL(/\/operations\/upgrades(?:\.html)?$/u);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('版本');
    await expect.poll(() => page.evaluate(
      () => (window as Window & { __docsNavigationMarker?: string }).__docsNavigationMarker,
    )).toBe(navigationMarker);
  });

  test('serves equivalent Chinese and English routes', async ({ page }) => {
    await page.goto('/operations/production');
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('把 Zhin 部署成可恢复的服务');

    await page.goto('/en/operations/production');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Run Zhin as a recoverable service');
  });

  test('copies a complete command block', async ({ context, page }) => {
    await context.grantPermissions(
      ['clipboard-read', 'clipboard-write'],
      { origin: 'http://127.0.0.1:4173' },
    );
    await page.goto('/operations/production');
    await page.waitForLoadState('networkidle');

    const composeBlock = page.locator('.vp-doc div[class*="language-"]')
      .filter({ hasText: 'docker compose up -d --build' });
    await composeBlock.locator('button.copy').click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain('docker compose up -d --build');
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain('curl --fail http://127.0.0.1:8068/pub/health');
  });

  test('keeps navigation and content usable on PC, tablet, and phone', async ({ page }) => {
    const viewports = [
      { name: 'PC', width: 1920, height: 1080, sidebar: true },
      { name: 'tablet', width: 1024, height: 768, sidebar: true },
      { name: 'phone', width: 390, height: 844, sidebar: false },
    ] as const;

    for (const viewport of viewports) {
      await test.step(viewport.name, async () => {
        await page.setViewportSize(viewport);
        await page.goto('/operations/production');
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        if (viewport.sidebar) {
          await expect(page.locator('.VPSidebar')).toBeVisible();
          await expect(page.locator('.VPNavBarHamburger')).toBeHidden();
        } else {
          await expect(page.locator('.VPNavBarHamburger')).toBeVisible();
          const contentBox = await page.locator('.VPContent').boundingBox();
          expect(contentBox).not.toBeNull();
          expect(contentBox!.x).toBeGreaterThanOrEqual(0);
          expect(contentBox!.width).toBeLessThanOrEqual(viewport.width);
        }
        const hasPageOverflow = await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth,
        );
        expect(hasPageOverflow, `${viewport.name} must not overflow horizontally`).toBe(false);
      });
    }
  });
});
