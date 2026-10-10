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
