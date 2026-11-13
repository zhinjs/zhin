import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * Browser journeys for the QQ captcha helper page (docs/public/login-assist/tcaptcha.html).
 * Tencent's loader is replaced by a fake that exposes capInit; nothing leaves the machine.
 */

const HELPER_PATH = '/login-assist/tcaptcha.html';
const CONSOLE_ORIGIN = 'https://console.example.test';
const QUERY = '?style=simple&aid=16&uin=10001&sid=7000000000000000000&cap_cd=cd-*abc_1&clientype=1&apptype=2';

type FakeResult = { ret: number; ticket?: string; randstr?: string };

/** `{ raw }` is used verbatim; strings are base64url-encoded as is; anything else as JSON. */
function fragment(payload: unknown): string {
  if (payload && typeof payload === 'object' && 'raw' in payload) return String((payload as { raw: string }).raw);
  return Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload)).toString('base64url');
}

function helperUrl(baseURL: string, payload: unknown): string {
  return `${baseURL}${HELPER_PATH}#${fragment(payload)}`;
}

/**
 * Block every request that is not the docs preview, the fake Tencent loader or the fake Console,
 * and record what was attempted.
 */
async function stubNetwork(context: BrowserContext, result: FakeResult) {
  const external: string[] = [];
  const loaderUrls: string[] = [];
  await context.route(() => true, async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return route.continue();
    external.push(url.href);
    return route.abort();
  });
  await context.route('https://ssl.captcha.qq.com/template/TCapIframeApi.js*', async (route) => {
    loaderUrls.push(route.request().url());
    await route.fulfill({
      contentType: 'application/javascript',
      body: `
        window.capInit = function (element, options) {
          window.__fakeCapInit = {
            element: element && element.id,
            capcd: options.capcd,
            showHeader: options.showHeader,
            entryUrl: location.href
          };
          setTimeout(function () { options.callback(${JSON.stringify(result)}); }, 50);
        };
      `,
    });
  });
  await context.route(`${CONSOLE_ORIGIN}/`, (route) => route.fulfill({
    contentType: 'text/html',
    body: `<!doctype html><title>console</title><script>
      window.__messages = [];
      addEventListener('message', function (event) {
        window.__messages.push({ origin: event.origin, data: event.data });
      });
    </script>`,
  }));
  return { external, loaderUrls };
}

async function openFromConsole(page: Page, url: string): Promise<Page> {
  await page.goto(`${CONSOLE_ORIGIN}/`);
  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    page.evaluate((target) => { window.open(target, 'zhin-captcha', 'width=420,height=640'); }, url),
  ]);
  return popup;
}

test.describe('login-assist captcha helper', () => {
  test('posts the ticket to the opener with the exact Console origin and closes', async ({ page, context, baseURL }) => {
    const { external, loaderUrls } = await stubNetwork(context, { ret: 0, ticket: 'T', randstr: 'R' });
    const popup = await openFromConsole(page, helperUrl(baseURL!, { q: QUERY, n: 'nonce-123', o: CONSOLE_ORIGIN }));

    await expect(popup.getByRole('heading', { name: '验证完成，可以关闭此窗口' })).toBeVisible();
    const fake = await popup.evaluate(() => (window as unknown as { __fakeCapInit: unknown }).__fakeCapInit);
    expect(fake).toEqual({
      element: 'captcha',
      capcd: 'cd-*abc_1',
      showHeader: false,
      // The fragment (nonce, Console origin) is dropped before Tencent's loader runs.
      entryUrl: `${baseURL}${HELPER_PATH}`,
    });

    await expect.poll(() => page.evaluate(() => (window as unknown as { __messages: unknown[] }).__messages))
      .toEqual([{
        origin: new URL(baseURL!).origin,
        data: { type: 'zhin.login-assist.captcha', nonce: 'nonce-123', ticket: 'T', randstr: 'R' },
      }]);
    await popup.waitForEvent('close', { timeout: 5_000 });

    expect(loaderUrls).toEqual([`https://ssl.captcha.qq.com/template/TCapIframeApi.js${QUERY}`]);
    expect(external).toEqual([]);
  });

  test('never delivers the ticket to an opener whose origin differs from the requested one', async ({ page, context, baseURL }) => {
    await stubNetwork(context, { ret: 0, ticket: 'T', randstr: 'R' });
    const popup = await openFromConsole(page, helperUrl(baseURL!, { q: QUERY, n: 'nonce-123', o: 'https://other.example.test' }));

    await expect(popup.getByRole('heading', { name: '验证完成，可以关闭此窗口' })).toBeVisible();
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as { __messages: unknown[] }).__messages)).toEqual([]);
  });

  test('without an opener shows a copyable ticket,randstr string', async ({ page, context, baseURL }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(baseURL!).origin });
    await stubNetwork(context, { ret: 0, ticket: 'T', randstr: 'R' });
    await page.goto(helperUrl(baseURL!, { q: QUERY, n: 'nonce-123', o: CONSOLE_ORIGIN }));

    await expect(page.getByRole('heading', { name: '验证完成' })).toBeVisible();
    const field = page.getByLabel('验证结果（ticket,randstr）');
    await expect(field).toHaveValue('T,R');
    await page.getByRole('button', { name: '复制' }).click();
    await expect(page.getByRole('button', { name: '已复制' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('T,R');
  });

  test('a failed or closed captcha offers a retry', async ({ page, context, baseURL }) => {
    const { loaderUrls } = await stubNetwork(context, { ret: 2 });
    await page.goto(helperUrl(baseURL!, { q: QUERY, n: 'nonce-123', o: CONSOLE_ORIGIN }));

    await expect(page.getByRole('heading', { name: '验证未完成' })).toBeVisible();
    await expect(page.getByLabel('验证结果（ticket,randstr）')).toBeHidden();
    await page.getByRole('button', { name: '重试' }).click();
    await expect.poll(() => loaderUrls.length).toBe(2);
    await expect(page.getByRole('heading', { name: '验证未完成' })).toBeVisible();
  });

  const invalid: Array<[string, unknown]> = [
    ['missing fragment', { raw: '' }],
    ['not base64url', { raw: '%%%' }],
    ['not JSON', 'not json'],
    ['JSON array', [QUERY, 'n', CONSOLE_ORIGIN]],
    ['query without ?', { q: QUERY.slice(1), n: 'n', o: CONSOLE_ORIGIN }],
    ['unknown query parameter', { q: `${QUERY}&callback=evil`, n: 'n', o: CONSOLE_ORIGIN }],
    ['duplicate query parameter', { q: `${QUERY}&sid=1`, n: 'n', o: CONSOLE_ORIGIN }],
    ['unencoded value', { q: '?sid=a"b<c', n: 'n', o: CONSOLE_ORIGIN }],
    ['oversized query', { q: `?cap_cd=${'a'.repeat(5000)}`, n: 'n', o: CONSOLE_ORIGIN }],
    ['javascript origin', { q: QUERY, n: 'n', o: 'javascript:alert(1)' }],
    ['origin with a path', { q: QUERY, n: 'n', o: `${CONSOLE_ORIGIN}/console` }],
    ['wildcard origin', { q: QUERY, n: 'n', o: '*' }],
    ['empty nonce', { q: QUERY, n: '', o: CONSOLE_ORIGIN }],
    ['oversized nonce', { q: QUERY, n: 'n'.repeat(129), o: CONSOLE_ORIGIN }],
  ];
  for (const [name, payload] of invalid) {
    test(`rejects ${name} without loading Tencent`, async ({ page, context, baseURL }) => {
      const { loaderUrls } = await stubNetwork(context, { ret: 0, ticket: 'T', randstr: 'R' });
      const hash = fragment(payload);
      await page.goto(`${baseURL}${HELPER_PATH}${hash ? `#${hash}` : ''}`);
      await expect(page.getByRole('heading', { name: '链接无效' })).toBeVisible();
      await expect(page.getByRole('status')).toContainText('重新点击');
      expect(loaderUrls).toEqual([]);
    });
  }

  test('refuses to run inside a frame', async ({ page, context, baseURL }) => {
    const { loaderUrls } = await stubNetwork(context, { ret: 0, ticket: 'T', randstr: 'R' });
    // about:blank host page: an https page could not frame the http preview (mixed content).
    const src = helperUrl(baseURL!, { q: QUERY, n: 'n', o: CONSOLE_ORIGIN });
    await page.setContent(`<iframe src="${src}"></iframe>`);
    const frame = page.frameLocator('iframe');
    await expect(frame.getByRole('heading', { name: '不能在框架中打开' })).toBeVisible();
    expect(loaderUrls).toEqual([]);
  });

  test.describe('in English', () => {
    test.use({ locale: 'en-US' });

    test('follows navigator.language', async ({ page, context, baseURL }) => {
      await stubNetwork(context, { ret: 0, ticket: 'T', randstr: 'R' });
      await page.goto(helperUrl(baseURL!, { q: QUERY, n: 'n', o: CONSOLE_ORIGIN }));
      await expect(page.getByRole('heading', { name: 'QQ login verification' })).toBeVisible();
      await expect(page.getByLabel('Result (ticket,randstr)')).toHaveValue('T,R');
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    });
  });
});
