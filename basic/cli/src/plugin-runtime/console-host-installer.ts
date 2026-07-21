import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { ServerResponse } from 'node:http';
import {
  ClientBuildModuleRuntime,
  TypeScriptClientBuilder,
} from '@zhin.js/pagemanager/client-build';
import {
  ALLOWED_ESM_CANONICAL,
  decodeSpecifierSegment,
  getOrBuildCanonicalEsmBundle,
} from '@zhin.js/pagemanager/node';
import {
  ConsoleRuntime,
  consoleRuntimeToken,
} from '@zhin.js/pagemanager/plugin-runtime';
import { httpHostToken } from '@zhin.js/host-http';
import {
  NativeDevelopmentModuleRuntime,
  type ModuleRuntime,
  type RootResourceInstaller,
} from '@zhin.js/runtime';

const publicAccess = Object.freeze({ permissions: [] as string[], roles: [] as string[] });
const clientPublicBase = '/assets/client';

export interface ConsoleHostModules {
  readonly modules: ModuleRuntime;
  readonly console: ConsoleRuntime;
  readonly clientOutDir: string;
  readonly projectRoot: string;
}

export function createConsoleHostModules(projectRoot: string, watch: boolean): ConsoleHostModules {
  const clientOutDir = join(projectRoot, '.zhin', 'client');
  const server = new NativeDevelopmentModuleRuntime({ projectRoot, watch });
  const client = new TypeScriptClientBuilder({
    projectRoot,
    outDir: clientOutDir,
    publicBase: clientPublicBase,
    consoleBasePath: '/',
  });
  return Object.freeze({
    modules: new ClientBuildModuleRuntime(server, client),
    console: new ConsoleRuntime(),
    clientOutDir,
    projectRoot,
  });
}

export function installConsoleHttp(options: {
  readonly console: ConsoleRuntime;
  readonly clientOutDir: string;
  /** Resolve directory for Host React ESM proxies (`react` package resolution). */
  readonly projectRoot: string;
}): RootResourceInstaller {
  return ({ resources }) => {
    resources.provide(consoleRuntimeToken, options.console);
    const http = resources.use(httpHostToken);
    // Browser ESM 裸导入（react/jsx-runtime 等）由 TypeScriptClientBuilder 改写为 /esm/<enc>.mjs
    http.route('GET', '/esm/*', async (_request, response, url) => {
      await serveCanonicalEsm(options.projectRoot, url.pathname, response);
    });
    http.route('GET', `${clientPublicBase}/*`, async (_request, response, url) => {
      await serveClientAsset(options.clientOutDir, clientPublicBase, url.pathname, response);
    });
    http.route('GET', '/console/api/pages', async (_request, response) => {
      const pages = await options.console.runView(publicAccess, (catalog) => catalog.pages());
      writeJson(response, 200, { pages });
    });
    http.route('GET', '/console', async (_request, response) => {
      const pages = await options.console.runView(publicAccess, (catalog) => catalog.pages());
      writeHtml(response, renderConsoleIndex(pages));
    });
    // Catch-all page routes must be registered last among exact/prefix peers;
    // matchHttpRoute prefers longest prefix, exact page routes win over shorter prefixes.
    http.route('GET', '/*', async (_request, response, url) => {
      if (url.pathname === '/console' || url.pathname.startsWith('/console/')
        || url.pathname.startsWith(`${clientPublicBase}/`)
        || url.pathname.startsWith('/esm/')) {
        response.writeHead(404);
        response.end();
        return;
      }
      try {
        const match = await options.console.runView(publicAccess, (catalog) => catalog.match(url.pathname));
        if (match.status === 'missing') {
          response.writeHead(404);
          response.end();
          return;
        }
        if (match.status === 'forbidden') {
          response.writeHead(403);
          response.end('Forbidden');
          return;
        }
        writeHtml(response, renderPageShell(match.page));
      } catch {
        response.writeHead(503);
        response.end('ConsoleRuntime is not ready');
      }
    });
  };
}

/**
 * Serve Host-proxied React/router ESM modules (legacy `consoleApiRouter` `/esm/:enc.mjs` parity).
 * Path: `/esm/<encodeURIComponent(canonical).replace(/%2F/g,'~')>.mjs`
 */
async function serveCanonicalEsm(
  resolveDir: string,
  pathname: string,
  response: ServerResponse,
): Promise<void> {
  const match = pathname.match(/^\/esm\/(.+)\.mjs$/u);
  if (!match) {
    response.writeHead(404);
    response.end();
    return;
  }
  let canonical: string;
  try {
    canonical = decodeSpecifierSegment(match[1]!);
  } catch {
    response.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ message: 'Invalid esm enc' }));
    return;
  }
  if (!ALLOWED_ESM_CANONICAL.has(canonical)) {
    response.writeHead(403, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ message: 'ESM canonical not allowed' }));
    return;
  }
  try {
    const code = await getOrBuildCanonicalEsmBundle(canonical, resolveDir, '/');
    response.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    });
    response.end(code);
  } catch (error) {
    response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({
      message: error instanceof Error ? error.message : 'Failed to build ESM',
    }));
  }
}

async function serveClientAsset(
  outDir: string,
  publicBase: string,
  pathname: string,
  response: ServerResponse,
): Promise<void> {
  const relativePath = pathname.slice(publicBase.length).replace(/^\/+/u, '');
  if (!relativePath || relativePath.includes('\0')) {
    response.writeHead(400);
    response.end();
    return;
  }
  const file = resolve(outDir, relativePath);
  const root = resolve(outDir);
  const rel = relative(root, file);
  if (!rel || rel.startsWith(`..${sep}`) || rel === '..') {
    response.writeHead(403);
    response.end();
    return;
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404);
    response.end();
    return;
  }
  response.writeHead(200, {
    'content-type': 'text/javascript; charset=utf-8',
    'cache-control': 'public, max-age=31536000, immutable',
  });
  createReadStream(file).pipe(response);
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

function writeHtml(response: ServerResponse, html: string): void {
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(html),
  });
  response.end(html);
}

function renderConsoleIndex(pages: readonly { readonly route: string; readonly title: string }[]): string {
  const items = pages.map((page) => (
    `<li><a href="${escapeHtml(page.route)}">${escapeHtml(page.title)}</a> <code>${escapeHtml(page.route)}</code></li>`
  )).join('\n');
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Zhin Console</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 2rem; color: #111; }
    code { background: #f4f4f5; padding: 0.1rem 0.35rem; border-radius: 4px; }
    a { color: #0f766e; }
  </style>
</head>
<body>
  <h1>Zhin Console</h1>
  <p>Plugin Runtime pages (ADR 0046). Sandbox chat uses WebSocket <code>/sandbox</code>.</p>
  <ul>
    ${items || '<li>No pages discovered yet.</li>'}
  </ul>
</body>
</html>`;
}

function renderPageShell(page: {
  readonly title: string;
  readonly route: string;
  readonly module: string;
  readonly localName: string;
}): string {
  const isSandbox = page.localName === 'sandbox';
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(page.title)}</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; font-family: ui-sans-serif, system-ui, sans-serif; background: #fafafa; color: #18181b; }
    header { padding: 0.75rem 1rem; border-bottom: 1px solid #e4e4e7; background: #fff; display: flex; gap: 1rem; align-items: center; }
    header a { color: #0f766e; text-decoration: none; }
    #root { min-height: calc(100vh - 3rem); }
    .sandbox-shell { display: flex; flex-direction: column; height: calc(100vh - 3rem); max-width: 720px; margin: 0 auto; }
    .log { flex: 1; overflow: auto; padding: 1rem; display: flex; flex-direction: column; gap: 0.5rem; }
    .bubble { padding: 0.6rem 0.8rem; border-radius: 10px; max-width: 85%; white-space: pre-wrap; word-break: break-word; }
    .in { align-self: flex-start; background: #fff; border: 1px solid #e4e4e7; }
    .out { align-self: flex-end; background: #ccfbf1; border: 1px solid #99f6e4; }
    .composer { display: flex; gap: 0.5rem; padding: 0.75rem; border-top: 1px solid #e4e4e7; background: #fff; }
    .composer input { flex: 1; padding: 0.55rem 0.75rem; border: 1px solid #d4d4d8; border-radius: 8px; }
    .composer button { padding: 0.55rem 0.9rem; border: 0; border-radius: 8px; background: #0f766e; color: #fff; cursor: pointer; }
    .status { font-size: 0.85rem; color: #71717a; }
  </style>
  <script type="importmap">
  {
    "imports": {
      "react": "https://esm.sh/react@19.1.0",
      "react/jsx-runtime": "https://esm.sh/react@19.1.0/jsx-runtime",
      "react-dom/client": "https://esm.sh/react-dom@19.1.0/client"
    }
  }
  </script>
</head>
<body>
  <header>
    <a href="/console">Console</a>
    <strong>${escapeHtml(page.title)}</strong>
    <span class="status" id="ws-status">connecting…</span>
  </header>
  <div id="root"></div>
  ${isSandbox ? sandboxFallbackScript() : pageModuleScript(page.module)}
</body>
</html>`;
}

function sandboxFallbackScript(): string {
  return `<script type="module">
const root = document.getElementById('root');
root.innerHTML = \`
  <div class="sandbox-shell">
    <div class="log" id="log"></div>
    <form class="composer" id="form">
      <input id="input" placeholder="发送到 /sandbox …" autocomplete="off" />
      <button type="submit">发送</button>
    </form>
  </div>
\`;
const log = document.getElementById('log');
const status = document.getElementById('ws-status');
const form = document.getElementById('form');
const input = document.getElementById('input');
function resolveSandboxWsUrl() {
  const token = (typeof localStorage !== 'undefined' && (localStorage.getItem('zhin_api_token') || ''))
    || (typeof window !== 'undefined' && window.__ZHIN_API_TOKEN)
    || '';
  const base = (typeof localStorage !== 'undefined' && localStorage.getItem('zhin_api_base')?.trim())
    || location.origin;
  const url = new URL('/sandbox', base.endsWith('/') ? base : base + '/');
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (token) url.searchParams.set('token', token);
  return url.href;
}
const ws = new WebSocket(resolveSandboxWsUrl());
function push(kind, text) {
  const el = document.createElement('div');
  el.className = 'bubble ' + kind;
  el.textContent = text;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
}
ws.addEventListener('open', () => { status.textContent = 'connected'; });
ws.addEventListener('close', () => { status.textContent = 'disconnected'; });
ws.addEventListener('error', () => { status.textContent = 'error (check token / Host)'; });
ws.addEventListener('message', (event) => {
  try {
    const data = JSON.parse(String(event.data));
    const text = Array.isArray(data.content)
      ? data.content.map((s) => s?.data?.text ?? '').filter(Boolean).join('\\n')
      : String(data.content ?? event.data);
    push('in', text || String(event.data));
  } catch {
    push('in', String(event.data));
  }
});
form.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ text, timestamp: Date.now() }));
  push('out', text);
  input.value = '';
});
</script>`;
}

function pageModuleScript(moduleUrl: string): string {
  return `<script type="module">
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import * as page from ${JSON.stringify(moduleUrl)};
const Component = page.default ?? page.SandboxPage ?? page;
createRoot(document.getElementById('root')).render(createElement(Component));
</script>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
