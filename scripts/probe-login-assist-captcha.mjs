#!/usr/bin/env node
/**
 * Manual probe (not run in CI): open docs/public/login-assist/tcaptcha.html in Chromium with the
 * REAL Tencent loader and a dummy slider query, report CSP violations / failed requests and save
 * light, dark, mobile and English screenshots (`real-*.png`). It also saves the page's own result
 * screens with a fake loader (`done-*.png`). Needs network access to *.captcha.qq.com and
 * captcha.gtimg.com; Tencent answers "refreshing too often" when probed repeatedly.
 *
 *   node scripts/probe-login-assist-captcha.mjs [outDir]
 *   PROBE_STRIP=csp,referrer …   serve the page without those metas (baseline comparison)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs/public');
const outDir = path.resolve(process.argv[2] ?? 'captcha-helper-shots');
fs.mkdirSync(outDir, { recursive: true });

const types = { '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
  let body = fs.readFileSync(file);
  // PROBE_STRIP=csp,referrer: serve the page without those metas to compare against a baseline.
  for (const name of (process.env.PROBE_STRIP ?? '').split(',').filter(Boolean)) {
    const meta = name === 'csp' ? /<meta http-equiv="Content-Security-Policy"[^>]*>/ : /<meta name="referrer"[^>]*>/;
    body = Buffer.from(body.toString('utf8').replace(meta, ''));
  }
  res.end(body);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const query = '?style=simple&aid=16&uin=10001&sid=7000000000000000000&cap_cd=probe-dummy&clientype=1&apptype=2';
const fragment = Buffer.from(JSON.stringify({ q: query, n: 'probe-nonce', o: 'https://console.example.test' }))
  .toString('base64url');
const url = `${base}/login-assist/tcaptcha.html#${fragment}`;

// PLAYWRIGHT_CHROMIUM_EXECUTABLE: use a preinstalled Chromium whose revision differs from @playwright/test.
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
const shots = [
  { name: 'light', colorScheme: 'light', viewport: { width: 520, height: 720 }, locale: 'zh-CN' },
  { name: 'dark', colorScheme: 'dark', viewport: { width: 520, height: 720 }, locale: 'zh-CN' },
  { name: 'mobile', colorScheme: 'light', viewport: { width: 375, height: 740 }, locale: 'zh-CN', isMobile: true, hasTouch: true },
  { name: 'english', colorScheme: 'light', viewport: { width: 520, height: 720 }, locale: 'en-US' },
];
let failed = false;
for (const shot of shots) {
  const context = await browser.newContext(shot);
  const page = await context.newPage();
  const violations = [];
  const hosts = new Set();
  const failures = [];
  page.on('console', (msg) => {
    if (/Content Security Policy|Refused to/i.test(msg.text())) violations.push(msg.text());
  });
  page.on('request', (req) => hosts.add(new URL(req.url()).host));
  page.on('requestfailed', (req) => failures.push(`${req.url()} ${req.failure()?.errorText}`));
  page.on('framenavigated', (frame) => hosts.add(new URL(frame.url()).host || frame.url()));
  await page.goto(url);
  // The captcha iframe is rendered by Tencent; wait for it, then give its content time to paint.
  // TCapIframeApi.js appends its own overlay and iframe to <body>.
  const frame = await page.waitForSelector('iframe[src*="captcha"]', { timeout: 20_000 }).catch(() => null);
  await page.waitForTimeout(6_000);
  await page.screenshot({ path: path.join(outDir, `real-${shot.name}.png`), fullPage: true });
  console.log(`[${shot.name}] iframe=${Boolean(frame)} hosts=${[...hosts].join(', ')}`);
  if (violations.length) console.log(`[${shot.name}] CSP:\n  ${violations.join('\n  ')}`);
  if (failures.length) console.log(`[${shot.name}] failed requests:\n  ${failures.join('\n  ')}`);
  if (!frame) failed = true;
  await context.close();

  // The page's own result screen (no opener → copyable ticket), with a fake loader.
  const fake = await browser.newContext(shot);
  await fake.route('https://ssl.captcha.qq.com/template/TCapIframeApi.js*', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: 'window.capInit=function(e,o){setTimeout(function(){o.callback({ret:0,ticket:"t03ExampleTicket_0123456789abcdefghijklmnopqrstuvwxyz",randstr:"@AbC"})},300)}',
  }));
  const fakePage = await fake.newPage();
  await fakePage.goto(url);
  await fakePage.waitForSelector('#result:not([hidden])');
  await fakePage.screenshot({ path: path.join(outDir, `done-${shot.name}.png`), fullPage: true });
  await fake.close();
}
await browser.close();
server.close();
console.log(`screenshots: ${outDir}`);
process.exitCode = failed ? 1 : 0;
