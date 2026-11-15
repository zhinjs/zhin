/**
 * Audit of plugin Console pages (`auditPluginPages`, ADR 0063 D20 第 3 条): bundles each page with
 * a mount entry (audit/mount-page.jsx), opens it in Chromium with the published
 * `@zhin.js/console-ui/styles.css`, and runs the layout audit at every width × theme.
 *
 * Node side only. Needs `esbuild` and `@playwright/test` (or `playwright`), resolved from the
 * repository first; both are optional peers of @zhin.js/console-ui, never runtime dependencies of
 * the browser package. A preinstalled Chromium can be selected with PLAYWRIGHT_CHROMIUM_EXECUTABLE.
 *
 * Pages the audit cannot mount on its own (declarative blueprints / adapter pages, rendered by the
 * Console renderers) are returned with `mounted: false` and a `skipped` reason and no violations,
 * unless the request names a `mountModule` (a module exporting `mountPluginPage(context)`, see
 * mount-page.jsx) that renders them.
 */
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { AUDIT_THEMES, AUDIT_WIDTHS, auditPage } from './layout-audit.mjs';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Imports the ESM entry of a package installed under one of `roots` (first match wins). */
async function importFrom(roots, ids) {
  for (const id of ids) {
    for (const root of roots) {
      let manifestPath;
      try {
        manifestPath = createRequire(join(root, 'package.json')).resolve(`${id}/package.json`);
      } catch {
        continue;
      }
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      const main = manifest.exports?.['.'];
      const entry = (typeof main === 'string' ? main : main?.import?.default ?? main?.import ?? main?.default) ?? manifest.module ?? manifest.main ?? 'index.js';
      const module = await import(pathToFileURL(join(dirname(manifestPath), typeof entry === 'string' ? entry : 'index.js')).href);
      return { ...(module.default && typeof module.default === 'object' ? module.default : {}), ...module };
    }
  }
  throw new Error(`@zhin.js/console-ui/audit needs one of ${ids.join(', ')} (optional peer dependency)`);
}

function resolveDir(id) {
  return dirname(createRequire(join(packageRoot, 'package.json')).resolve(`${id}/package.json`));
}

/**
 * @param {{
 *   repoRoot: string,
 *   widths?: number[],
 *   themes?: ('light'|'dark')[],
 *   plugins: { plugin: string, directory: string, packageName: string, pages: { name: string, entry: string }[] }[],
 *   mountModule?: string,
 *   checks?: string[],
 * }} request
 * @returns {Promise<{ pages: { plugin: string, page: string, mounted: boolean, skipped?: string,
 *   violations: { check: string, width: number, theme: 'light'|'dark', message: string, selector?: string }[],
 *   exemptions?: { check: string, reason: string, selector?: string }[] }[] }>}
 */
export async function auditPluginPages(request) {
  const { repoRoot, widths = AUDIT_WIDTHS, themes = AUDIT_THEMES, plugins } = request;
  const styles = join(packageRoot, 'dist/styles.css');
  if (!existsSync(styles)) throw new Error('@zhin.js/console-ui/audit: dist/styles.css is missing; build @zhin.js/console-ui first');
  const roots = [repoRoot, packageRoot];
  const esbuild = await importFrom(roots, ['esbuild']);
  const { chromium } = await importFrom(roots, ['@playwright/test', 'playwright', 'playwright-core']);
  const mountModule = request.mountModule ?? process.env.ZHIN_UI_AUDIT_MOUNT_MODULE;
  const work = mkdtempSync(join(tmpdir(), 'zhin-ui-audit-'));
  copyFileSync(styles, join(work, 'styles.css'));
  // Served over http (not file://): pages may open WebSockets or fetch relative to their origin.
  const server = await serve(work);
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined });
  const results = [];
  try {
    for (const plugin of plugins) {
      for (const pageSpec of plugin.pages) {
        results.push(await auditOne({ esbuild, browser, work, origin: server.origin, plugin, pageSpec, widths, themes, mountModule, repoRoot, checks: request.checks }));
      }
    }
  } finally {
    await browser.close();
    await server.close();
    rmSync(work, { recursive: true, force: true });
  }
  return { pages: results };
}

async function auditOne({ esbuild, browser, work, origin, plugin, pageSpec, widths, themes, mountModule, repoRoot, checks }) {
  const result = { plugin: plugin.plugin, page: pageSpec.name, mounted: false, violations: [], exemptions: [] };
  const id = `${plugin.plugin}/${pageSpec.name}`.replace(/[^a-z0-9]+/giu, '-');
  const entry = join(work, `${id}.entry.tsx`);
  const pagePath = resolve(plugin.directory, pageSpec.entry);
  const mounter = join(packageRoot, 'audit/mount-page.jsx');
  writeFileSync(entry, [
    `import * as pageModule from ${JSON.stringify(pagePath)};`,
    `import { mountAuditPage } from ${JSON.stringify(mounter)};`,
    mountModule ? `import * as custom from ${JSON.stringify(resolve(repoRoot, mountModule))};` : 'const custom = undefined;',
    `void mountAuditPage(pageModule, ${JSON.stringify(pageSpec.name)}, custom);`,
  ].join('\n'));
  try {
    await esbuild.build({
      entryPoints: [entry],
      outfile: join(work, `${id}.js`),
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: 'es2022',
      jsx: 'automatic',
      loader: { '.css': 'css', '.svg': 'dataurl', '.png': 'dataurl' },
      define: { 'process.env.NODE_ENV': '"production"' },
      nodePaths: [join(plugin.directory, 'node_modules'), join(repoRoot, 'node_modules'), join(packageRoot, 'node_modules')],
      // One React and one @zhin.js/console-ui, as in the Console (shared singletons).
      alias: {
        react: resolveDir('react'),
        'react-dom': resolveDir('react-dom'),
      },
      // Workspace sources in the repository (the `development` export condition), built output elsewhere.
      conditions: ['development'],
      logLevel: 'silent',
    });
  } catch (error) {
    const message = error?.errors?.[0]?.text ?? String(error?.message ?? error);
    result.violations.push(...themes.flatMap((theme) => widths.map((width) => ({ check: 'mount', width, theme, message: `page does not build: ${message}` }))));
    return result;
  }
  const css = existsSync(join(work, `${id}.css`)) ? `<link rel="stylesheet" href="./${id}.css" />` : '';
  writeFileSync(join(work, `${id}.html`), `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><link rel="stylesheet" href="./styles.css" />${css}</head><body><div id="root"></div><script src="./${id}.js"></script></body></html>`);
  const url = `${origin}/${id}.html`;
  const page = await browser.newPage({ locale: 'zh-CN', deviceScaleFactor: 1 });
  const exemptionKeys = new Set();
  try {
    for (const theme of themes) {
      for (const width of widths) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`${url}?theme=${theme}`);
        const state = await page.waitForFunction(() => window.__zhinUiAudit, undefined, { timeout: 15_000 }).then((handle) => handle.jsonValue()).catch(() => ({ status: 'error', message: 'the page did not finish mounting within 15s' }));
        if (state.status === 'unsupported') {
          result.skipped = state.message;
          return result;
        }
        if (state.status === 'error') {
          result.violations.push({ check: 'mount', width, theme, message: `page failed to render: ${state.message}` });
          continue;
        }
        result.mounted = true;
        const run = await auditPage(page, { checks });
        for (const violation of run.violations) {
          result.violations.push({ check: violation.check, width, theme, message: violation.message, selector: violation.selector });
        }
        for (const exemption of run.exemptions) {
          const key = `${exemption.check}|${exemption.selector}|${exemption.reason}`;
          if (exemptionKeys.has(key)) continue;
          exemptionKeys.add(key);
          result.exemptions.push({ check: exemption.check, reason: exemption.reason, selector: exemption.selector });
        }
      }
    }
  } finally {
    await page.close();
  }
  return result;
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

/** Minimal static server for the bundled pages (loopback only). */
function serve(directory) {
  const server = createServer((request, response) => {
    const name = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname).replace(/^\/+/u, '');
    const path = join(directory, name);
    if (!name || name.includes('..') || !existsSync(path)) {
      response.writeHead(404).end();
      return;
    }
    const extension = name.slice(name.lastIndexOf('.'));
    response.writeHead(200, { 'content-type': TYPES[extension] ?? 'application/octet-stream' }).end(readFileSync(path));
  });
  return new Promise((resolvePromise) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolvePromise({ origin: `http://127.0.0.1:${port}`, close: () => new Promise((done) => server.close(() => done())) });
    });
  });
}
