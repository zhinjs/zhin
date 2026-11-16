import { createHtmlMessageNonce, createHtmlMessageDocument } from '../pages/index/HtmlMessage.js';

afterEach(() => vi.unstubAllGlobals());

it('creates a nonce without secure-context-only randomUUID', () => {
  const getRandomValues = vi.fn((bytes: Uint8Array) => bytes.fill(7));
  vi.stubGlobal('crypto', { getRandomValues });
  const nonce = createHtmlMessageNonce();
  expect(getRandomValues).toHaveBeenCalledTimes(1);
  expect(nonce).toBe('07'.repeat(16));
  expect(createHtmlMessageDocument('content', nonce)).toContain(`nonce-${nonce}`);
});

it('installs the trusted reporter before raw content including unfinished script tags', () => {
  const html = '<div style="height:600px">visible</div><script';
  const document = createHtmlMessageDocument(html, '0123456789abcdef');
  expect(document.indexOf('const report=')).toBeLessThan(document.indexOf(html));
  expect(document).toContain("default-src 'none'");
  expect(document).toContain("base-uri 'none'; form-action 'none'");
  expect(document).toContain('height:document.body.getBoundingClientRect().height');
});

it('renders an HTML segment at its requested width and scales it down to the column (#1250)', async () => {
  const { htmlRenderWidth, htmlRenderScale } = await import('../pages/index/HtmlMessage.js');
  expect(htmlRenderWidth(1080)).toBe(1080);
  expect(htmlRenderWidth('720')).toBe(720);
  expect(htmlRenderWidth(0)).toBeUndefined();
  expect(htmlRenderWidth('wide')).toBeUndefined();
  expect(htmlRenderWidth(1e9)).toBe(4096);
  // A 1080px menu in a 300px chat column is shown at 300/1080, never enlarged.
  expect(htmlRenderScale(1080, 300)).toBeCloseTo(300 / 1080);
  expect(htmlRenderScale(400, 600)).toBe(1);
  expect(htmlRenderScale(undefined, 300)).toBe(1);
  const sized = createHtmlMessageDocument('<main>menu</main>', '0123456789abcdef', 1080);
  expect(sized).toContain('html,body{width:1080px;overflow:hidden}');
  expect(sized.indexOf('const report=')).toBeLessThan(sized.indexOf('<main>menu</main>'));
  expect(createHtmlMessageDocument('<main>menu</main>', '0123456789abcdef')).not.toContain('html,body{width:');
});
