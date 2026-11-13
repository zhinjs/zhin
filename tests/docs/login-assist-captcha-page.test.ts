import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Static contract of the QQ captcha helper page. Browser behaviour is covered by
 * docs/e2e/login-assist-captcha.spec.ts (pnpm test:docs:e2e).
 */
const pagePath = path.resolve(__dirname, '../../docs/public/login-assist/tcaptcha.html');
// Browsers normalise CRLF to LF before hashing inline scripts; a Windows checkout may have CRLF.
const html = readFileSync(pagePath, 'utf8').replace(/\r\n?/g, '\n');
const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)?.[1] ?? '';
const directives = new Map(
  csp.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const [name, ...values] = part.split(/\s+/);
    return [name, values] as const;
  }),
);
// Case-insensitive and tolerant of `</script >` so a differently cased or spaced tag can't slip past
// the "exactly one inline script" check.
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];

describe('login-assist captcha helper page', () => {
  it('has exactly one inline script, allowed by its sha256 hash', () => {
    expect(scripts).toHaveLength(1);
    const [, attrs, body] = scripts[0];
    expect(attrs.trim()).toBe('');
    const hash = createHash('sha256').update(body, 'utf8').digest('base64');
    // On mismatch: replace the sha256 in the CSP meta of docs/public/login-assist/tcaptcha.html
    // with the value printed here.
    expect(directives.get('script-src')).toContain(`'sha256-${hash}'`);
  });

  it('keeps a strict CSP: no unsafe-inline/eval scripts, only Tencent captcha hosts', () => {
    expect(directives.get('default-src')).toEqual(["'none'"]);
    const scriptSrc = directives.get('script-src') ?? [];
    expect(scriptSrc.filter((source) => !source.startsWith("'sha256-"))).toEqual([
      'https://ssl.captcha.qq.com',
      'https://captcha.gtimg.com',
      'https://t.captcha.qq.com',
    ]);
    expect(directives.get('frame-src')).toEqual([
      'https://captcha.gtimg.com',
      'https://t.captcha.qq.com',
      'https://ssl.captcha.qq.com',
    ]);
    expect(directives.get('connect-src')).toEqual(['https://*.captcha.qq.com', 'https://captcha.gtimg.com']);
    expect(directives.get('worker-src')).toEqual(['blob:']);
    expect(directives.get('base-uri')).toEqual(["'none'"]);
    expect(directives.get('form-action')).toEqual(["'none'"]);
    expect(html).toContain('<meta name="referrer" content="no-referrer">');
  });

  it('loads only Tencent\'s loader, posts only to the given origin and stores nothing', () => {
    const script = scripts[0][2];
    expect(script).toContain("'https://ssl.captcha.qq.com/template/TCapIframeApi.js'");
    expect(script).not.toMatch(/\b(localStorage|sessionStorage|indexedDB|document\.cookie|fetch\(|XMLHttpRequest|sendBeacon)\b/);
    expect(script).not.toMatch(/postMessage\([^)]*'\*'/);
    expect(script).toContain('}, input.origin);');
    // Input comes from the fragment only.
    expect(script).toContain('decodeFragment(fragment)');
  });

  it('has no inline event handlers or external resources besides the docs link', () => {
    expect(html).not.toMatch(/\son[a-z]+=/i);
    const urls = [...html.matchAll(/https?:\/\/[A-Za-z0-9*.-]+/g)].map((match) => match[0]);
    const hosts = new Set(urls.map((url) => new URL(url).host));
    expect([...hosts].sort()).toEqual([
      '*.captcha.qq.com',
      'captcha.gtimg.com',
      'console.example.com',
      'ssl.captcha.qq.com',
      't.captcha.qq.com',
      'zhin.js.org',
    ]);
  });

  it('is served unmodified and unframeable by Cloudflare Pages (docs/public/_headers)', () => {
    const headers = readFileSync(path.resolve(__dirname, '../../docs/public/_headers'), 'utf8');
    const block = headers.split(/\n(?=\S)/).find((section) => section.startsWith('/login-assist/*')) ?? '';
    expect(block).toMatch(/Cache-Control: .*no-transform/);
    expect(block).toMatch(/Content-Security-Policy: frame-ancestors 'none'/);
    expect(block).toMatch(/X-Frame-Options: DENY/);
    expect(block).toMatch(/Referrer-Policy: no-referrer/);
  });
});
