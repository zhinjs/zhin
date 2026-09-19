export function renderConsoleIndex(pages: readonly { readonly route: string; readonly title: string }[]): string {
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

export function renderPageShell(page: {
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
  // Prefer the stored Host base (Remote Console) over page origin, then
  // flip http(s) → ws(s) from the *resolved base*, not location.protocol —
  // otherwise a https UI page + http Host would produce wss://http-host and fail.
  const storedToken = (typeof localStorage !== 'undefined' && localStorage.getItem('zhin_api_token'))
    || (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('zhin_api_token'))
    || '';
  const token = (typeof window !== 'undefined' && window.__ZHIN_API_TOKEN)
    || storedToken
    || '';
  const stored = (typeof localStorage !== 'undefined' && localStorage.getItem('zhin_api_base')?.trim())
    || '';
  const base = stored || location.origin;
  const url = new URL('/sandbox', base.endsWith('/') ? base : base + '/');
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
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
