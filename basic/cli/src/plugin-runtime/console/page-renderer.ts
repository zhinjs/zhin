export interface ConsoleIndexPage {
  readonly id?: string;
  readonly localName?: string;
  readonly owner?: string;
  readonly route: string;
  readonly title: string;
  readonly description?: string;
  readonly icon?: string;
  readonly group?: string;
  readonly order?: number;
  readonly hideInNav?: boolean;
  readonly titleI18n?: Readonly<Partial<Record<'zh-CN' | 'en' | string, string>>>;
}

export interface PageShellDescriptor {
  readonly id?: string;
  readonly owner?: string;
  readonly title: string;
  readonly route: string;
  readonly module: string;
  readonly localName: string;
  readonly description?: string;
  readonly group?: string;
}

export const BASE_STYLE = `
  :root {
    color-scheme: dark;
    --background: #09090b;
    --foreground: #fafafa;
    --card: #121215;
    --card-foreground: #fafafa;
    --popover: #121215;
    --popover-foreground: #fafafa;
    --primary: #14b8a6;
    --primary-foreground: #042f2e;
    --secondary: #27272a;
    --secondary-foreground: #fafafa;
    --muted: #18181b;
    --muted-foreground: #a1a1aa;
    --accent: #27272a;
    --accent-foreground: #fafafa;
    --destructive: #ef4444;
    --destructive-foreground: #fafafa;
    --border: #27272a;
    --input: #27272a;
    --ring: #14b8a6;
    --radius: 0.625rem;
  }
  *, *::before, *::after { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: var(--background);
    color: var(--foreground);
    line-height: 1.5;
  }
  a { color: var(--primary); text-decoration: none; }
  a:hover { text-decoration: underline; }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
  code { background: var(--secondary); color: var(--foreground); padding: 0.12rem 0.4rem; border-radius: 5px; font-size: 0.82em; }
  header.zhin-topbar {
    padding: 0.65rem 1.1rem;
    border-bottom: 1px solid var(--border);
    background: rgba(18, 18, 21, 0.92);
    backdrop-filter: blur(8px);
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: center;
    position: sticky;
    top: 0;
    z-index: 40;
  }
  .zhin-nav-links { display: inline-flex; gap: 0.5rem; align-items: center; }
  .zhin-nav-link {
    padding: 0.28rem 0.65rem;
    border-radius: 6px;
    background: var(--secondary);
    color: var(--foreground);
    font-size: 0.82rem;
    font-weight: 500;
    border: 1px solid var(--border);
    text-decoration: none;
  }
  .zhin-nav-link:hover { border-color: var(--primary); color: var(--primary); text-decoration: none; }
  .route-badge { font-size: 0.78rem; color: var(--muted-foreground); }
  #root, #app { min-height: calc(100vh - 3.25rem); }
  .status {
    font-size: 0.78rem;
    padding: 0.2rem 0.55rem;
    border-radius: 9999px;
    background: var(--muted);
    border: 1px solid var(--border);
    color: var(--muted-foreground);
  }
  .token-bar { margin-left: auto; display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; }
  .token-bar input {
    padding: 0.32rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--muted);
    color: var(--foreground);
    font-size: 0.8rem;
    width: 180px;
  }
  .token-bar button {
    padding: 0.32rem 0.68rem;
    border: 1px solid transparent;
    border-radius: 6px;
    background: var(--primary);
    color: var(--primary-foreground);
    font-weight: 600;
    font-size: 0.78rem;
    cursor: pointer;
  }
  .token-bar button.secondary {
    background: var(--secondary);
    color: var(--muted-foreground);
    border-color: var(--border);
    font-weight: 500;
  }
  /* Sandbox Shell */
  .sandbox-shell {
    display: flex;
    flex-direction: column;
    height: calc(100vh - 3.25rem);
    max-width: 900px;
    margin: 0 auto;
    border-left: 1px solid var(--border);
    border-right: 1px solid var(--border);
    background: var(--background);
  }
  .sandbox-toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    align-items: center;
    justify-content: space-between;
    padding: 0.6rem 1rem;
    border-bottom: 1px solid var(--border);
    background: var(--card);
    font-size: 0.82rem;
  }
  .scene-tabs { display: inline-flex; gap: 0.35rem; align-items: center; }
  .scene-tab {
    padding: 0.28rem 0.65rem;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--muted);
    color: var(--muted-foreground);
    font-size: 0.78rem;
    cursor: pointer;
  }
  .scene-tab.active {
    background: var(--primary);
    color: var(--primary-foreground);
    border-color: var(--primary);
    font-weight: 600;
  }
  .sender-bar { display: inline-flex; flex-wrap: wrap; gap: 0.4rem; align-items: center; }
  .sender-bar input, .sender-bar select, .scene-tabs input {
    padding: 0.25rem 0.5rem;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: var(--muted);
    color: var(--foreground);
    font-size: 0.78rem;
  }
  .log {
    flex: 1;
    overflow: auto;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }
  .bubble {
    padding: 0.65rem 0.85rem;
    border-radius: 10px;
    max-width: 85%;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 0.9rem;
  }
  .bubble.in {
    align-self: flex-start;
    background: var(--card);
    border: 1px solid var(--border);
    color: var(--card-foreground);
  }
  .bubble.out {
    align-self: flex-end;
    background: #115e59;
    border: 1px solid #0f766e;
    color: #f0fdfa;
  }
  .bubble-meta {
    font-size: 0.72rem;
    color: var(--muted-foreground);
    margin-bottom: 0.25rem;
    display: flex;
    gap: 0.4rem;
    align-items: center;
  }
  .segment-code {
    background: #050507;
    border: 1px solid var(--border);
    padding: 0.55rem 0.75rem;
    border-radius: 8px;
    overflow-x: auto;
    margin: 0.35rem 0;
    font-size: 0.82rem;
  }
  .segment-image {
    max-width: 280px;
    max-height: 240px;
    border-radius: 8px;
    display: block;
    margin: 0.35rem 0;
    border: 1px solid var(--border);
  }
  .segment-card {
    border: 1px solid var(--border);
    background: var(--muted);
    border-radius: 8px;
    padding: 0.65rem 0.8rem;
    margin: 0.35rem 0;
  }
  .segment-card-title { font-weight: 600; margin-bottom: 0.25rem; color: var(--foreground); }
  .segment-card-desc { font-size: 0.84rem; color: var(--muted-foreground); margin-bottom: 0.4rem; }
  .segment-card-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 0.35rem; margin-bottom: 0.4rem; font-size: 0.8rem; }
  .segment-html {
    width: 100%;
    min-height: 120px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: #fff;
    margin: 0.35rem 0;
  }
  .segment-actions { display: flex; flex-wrap: wrap; gap: 0.4rem; margin-top: 0.45rem; }
  .sandbox-action-btn {
    padding: 0.32rem 0.7rem;
    border-radius: 6px;
    border: 1px solid var(--primary);
    background: rgba(20, 184, 166, 0.14);
    color: #5eead4;
    font-size: 0.8rem;
    font-weight: 500;
    cursor: pointer;
  }
  .sandbox-action-btn:hover { background: var(--primary); color: var(--primary-foreground); }
  .quick-bar {
    display: flex;
    gap: 0.4rem;
    align-items: center;
    padding: 0.45rem 0.85rem;
    border-top: 1px solid var(--border);
    background: var(--card);
    flex-wrap: wrap;
  }
  .quick-chip {
    padding: 0.2rem 0.55rem;
    border-radius: 9999px;
    border: 1px solid var(--border);
    background: var(--muted);
    color: var(--muted-foreground);
    font-size: 0.76rem;
    cursor: pointer;
  }
  .quick-chip:hover { border-color: var(--primary); color: var(--primary); }
  .composer {
    display: flex;
    gap: 0.5rem;
    padding: 0.75rem 0.85rem;
    border-top: 1px solid var(--border);
    background: var(--card);
  }
  .composer input {
    flex: 1;
    padding: 0.55rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--muted);
    color: var(--foreground);
  }
  .composer button {
    padding: 0.55rem 1rem;
    border: 0;
    border-radius: 8px;
    background: var(--primary);
    color: var(--primary-foreground);
    font-weight: 600;
    cursor: pointer;
  }
  /* Console Hub */
  .console-hub { max-width: 1080px; margin: 0 auto; padding: 1.5rem 1.25rem; }
  .console-group { margin-top: 1.5rem; }
  .console-group-title { font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted-foreground); margin-bottom: 0.65rem; }
  .console-grid { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 0.75rem; }
  .console-card {
    padding: 0.9rem 1rem;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: var(--card);
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .console-card-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
  .console-card-meta { font-size: 0.78rem; color: var(--muted-foreground); display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; }
  .zhin-error-boundary {
    max-width: 680px;
    margin: 2rem auto;
    padding: 1.25rem;
    border-radius: 10px;
    border: 1px solid var(--destructive);
    background: rgba(239, 68, 68, 0.08);
    color: var(--foreground);
  }
  /* Common Tailwind / @zhin.js/client utility classes for standalone plugin pages */
  .bg-background { background-color: var(--background); }
  .text-foreground { color: var(--foreground); }
  .bg-card { background-color: var(--card); }
  .text-card-foreground { color: var(--card-foreground); }
  .bg-popover { background-color: var(--popover); }
  .text-popover-foreground { color: var(--popover-foreground); }
  .bg-primary { background-color: var(--primary); }
  .text-primary-foreground { color: var(--primary-foreground); }
  .bg-secondary { background-color: var(--secondary); }
  .text-secondary-foreground { color: var(--secondary-foreground); }
  .bg-muted { background-color: var(--muted); }
  .text-muted-foreground { color: var(--muted-foreground); }
  .bg-accent { background-color: var(--accent); }
  .text-accent-foreground { color: var(--accent-foreground); }
  .bg-destructive { background-color: var(--destructive); }
  .text-destructive { color: var(--destructive); }
  .border-border { border-color: var(--border); }
  .border-input { border-color: var(--input); }
  .flex { display: flex; }
  .inline-flex { display: inline-flex; }
  .grid { display: grid; }
  .block { display: block; }
  .inline-block { display: inline-block; }
  .hidden { display: none; }
  .flex-col { flex-direction: column; }
  .flex-row { flex-direction: row; }
  .flex-wrap { flex-wrap: wrap; }
  .flex-1 { flex: 1 1 0%; }
  .shrink-0 { flex-shrink: 0; }
  .grow { flex-grow: 1; }
  .items-center { align-items: center; }
  .items-start { align-items: flex-start; }
  .items-end { align-items: flex-end; }
  .justify-between { justify-content: space-between; }
  .justify-center { justify-content: justify-center; }
  .justify-end { justify-content: flex-end; }
  .gap-1 { gap: 0.25rem; }
  .gap-2 { gap: 0.5rem; }
  .gap-3 { gap: 0.75rem; }
  .gap-4 { gap: 1rem; }
  .gap-6 { gap: 1.5rem; }
  .p-2 { padding: 0.5rem; }
  .p-3 { padding: 0.75rem; }
  .p-4 { padding: 1rem; }
  .p-6 { padding: 1.5rem; }
  .px-2 { padding-left: 0.5rem; padding-right: 0.5rem; }
  .px-3 { padding-left: 0.75rem; padding-right: 0.75rem; }
  .px-4 { padding-left: 1rem; padding-right: 1rem; }
  .py-1 { padding-top: 0.25rem; padding-bottom: 0.25rem; }
  .py-2 { padding-top: 0.5rem; padding-bottom: 0.5rem; }
  .py-3 { padding-top: 0.75rem; padding-bottom: 0.75rem; }
  .m-0 { margin: 0; }
  .mx-auto { margin-left: auto; margin-right: auto; }
  .mt-2 { margin-top: 0.5rem; }
  .mt-4 { margin-top: 1rem; }
  .mb-2 { margin-bottom: 0.5rem; }
  .mb-4 { margin-bottom: 1rem; }
  .ml-auto { margin-left: auto; }
  .w-full { width: 100%; }
  .h-full { height: 100%; }
  .min-h-screen { min-height: 100vh; }
  .max-w-2xl { max-width: 42rem; }
  .max-w-4xl { max-width: 56rem; }
  .max-w-6xl { max-width: 72rem; }
  .border { border: 1px solid var(--border); }
  .border-b { border-bottom: 1px solid var(--border); }
  .border-t { border-top: 1px solid var(--border); }
  .rounded { border-radius: 0.25rem; }
  .rounded-md { border-radius: 0.375rem; }
  .rounded-lg { border-radius: 0.5rem; }
  .rounded-xl { border-radius: 0.75rem; }
  .rounded-2xl { border-radius: 1rem; }
  .rounded-full { border-radius: 9999px; }
  .text-xs { font-size: 0.75rem; }
  .text-sm { font-size: 0.875rem; }
  .text-base { font-size: 1rem; }
  .text-lg { font-size: 1.125rem; }
  .text-xl { font-size: 1.25rem; }
  .text-2xl { font-size: 1.5rem; }
  .font-medium { font-weight: 500; }
  .font-semibold { font-weight: 600; }
  .font-bold { font-weight: 700; }
  .font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
  .whitespace-pre-wrap { white-space: pre-wrap; }
  .break-words { word-break: break-word; }
  .overflow-auto { overflow: auto; }
  .overflow-hidden { overflow: hidden; }
  .cursor-pointer { cursor: pointer; }
  .opacity-50 { opacity: 0.5; }
`;

function inferPageCategory(page: ConsoleIndexPage): string {
  if (page.group && page.group.trim()) return page.group.trim();
  const owner = page.owner ?? '';
  const route = page.route ?? '';
  if (route === '/sandbox' || owner.includes('sandbox')) return 'sandbox';
  if (owner.includes('adapter') || /^\/(qq|icqq|onebot|discord|telegram|slack|kook|dingtalk|feishu|lark|wechat|line|github|email|satori)\b/iu.test(route)) {
    return 'adapter';
  }
  if (owner === 'root' || !owner) return 'core';
  return 'plugin';
}

export function renderConsoleIndex(pages: readonly ConsoleIndexPage[]): string {
  const sorted = [...pages].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  const groups = new Map<string, ConsoleIndexPage[]>();
  for (const page of sorted) {
    const group = inferPageCategory(page);
    const list = groups.get(group) ?? [];
    list.push(page);
    groups.set(group, list);
  }
  const groupHtml = [...groups.entries()].map(([group, groupPages]) => {
    const items = groupPages.map((page) => {
      const ownerBadge = page.owner ? `<span class="route-badge">${escapeHtml(page.owner)}</span>` : '';
      const desc = page.description ? `<div class="text-xs text-muted-foreground">${escapeHtml(page.description)}</div>` : '';
      return `<li class="console-card" data-group="${escapeHtml(group)}">
        <div class="console-card-head">
          <a href="${escapeHtml(page.route)}"><strong>${escapeHtml(page.title)}</strong></a>
          <code>${escapeHtml(page.route)}</code>
        </div>
        <div class="console-card-meta">${ownerBadge}</div>
        ${desc}
      </li>`;
    }).join('\n');
    return `<section class="console-group" data-group-section="${escapeHtml(group)}">
      <h2 class="console-group-title">${escapeHtml(group)}</h2>
      <ul class="console-grid">
        ${items}
      </ul>
    </section>`;
  }).join('\n');

  return `<!doctype html>
<html lang="zh-CN" class="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Zhin Console</title>
  <style>${BASE_STYLE}</style>
</head>
<body class="bg-background text-foreground">
  <header class="zhin-topbar">
    <div class="zhin-nav-links">
      <a class="zhin-nav-link" href="/console">Console</a>
      <a class="zhin-nav-link" href="/pages">Pages</a>
      <a class="zhin-nav-link" href="/sandbox">Sandbox</a>
    </div>
    <strong>Zhin Console</strong>
    <span class="status" id="ws-status">ready</span>
    <form class="token-bar" id="token-form">
      <input id="token-input" type="password" placeholder="HTTP_TOKEN (可选)" autocomplete="off" />
      <button type="submit">保存 Token</button>
      <button type="button" class="secondary" id="token-clear">清除</button>
    </form>
  </header>
  <main class="console-hub" id="root">
    <div id="app">
      <h1>Zhin Console</h1>
      <p class="text-sm text-muted-foreground">Plugin Runtime pages (ADR 0046). Sandbox chat uses WebSocket <code>/sandbox</code>.</p>
      ${groupHtml || '<ul><li>No pages discovered yet.</li></ul>'}
    </div>
  </main>
  ${standaloneTokenBootstrapScript(false)}
</body>
</html>`;
}

export function renderPageShell(
  page: PageShellDescriptor,
  options: {
    /** The page belongs to a plugin whose Endpoint declares `runtime.sandbox` (ADR 0044). */
    readonly runtimeSandbox?: boolean;
  } = {},
): string {
  const isSandbox = options.runtimeSandbox === true;
  return `<!doctype html>
<html lang="zh-CN" class="dark">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(page.title)}</title>
  <style>${BASE_STYLE}</style>
  <script type="importmap">
  {
    "imports": {
      "react": "https://esm.sh/react@19.1.0",
      "react/jsx-runtime": "https://esm.sh/react@19.1.0/jsx-runtime",
      "react/jsx-dev-runtime": "https://esm.sh/react@19.1.0/jsx-dev-runtime",
      "react-dom": "https://esm.sh/react-dom@19.1.0",
      "react-dom/client": "https://esm.sh/react-dom@19.1.0/client",
      "react-router": "https://esm.sh/react-router@7.6.0?deps=react@19.1.0,react-dom@19.1.0",
      "react-router-dom": "https://esm.sh/react-router-dom@7.6.0?deps=react@19.1.0,react-dom@19.1.0"
    }
  }
  </script>
</head>
<body class="bg-background text-foreground">
  <header class="zhin-topbar">
    <div class="zhin-nav-links">
      <a class="zhin-nav-link" href="/console">Console</a>
      <a class="zhin-nav-link" href="/sandbox">Sandbox</a>
    </div>
    <strong>${escapeHtml(page.title)}</strong>
    <code class="route-badge">${escapeHtml(page.route)}</code>
    <span class="status" id="ws-status">connecting…</span>
    <form class="token-bar" id="token-form">
      <input id="token-input" type="password" placeholder="HTTP_TOKEN (可选)" autocomplete="off" />
      <button type="submit">保存 Token 并重连</button>
      <button type="button" class="secondary" id="token-clear">清除</button>
    </form>
  </header>
  <div id="root"><div id="app"></div></div>
  ${isSandbox ? sandboxFallbackScript() : pageModuleScript(page.module, page)}
</body>
</html>`;
}

function standaloneTokenBootstrapScript(probeAuth = true): string {
  return `<script type="module">
const statusEl = document.getElementById('ws-status');
const tokenForm = document.getElementById('token-form');
const tokenInput = document.getElementById('token-input');
const tokenClear = document.getElementById('token-clear');
function storeTokens(token) {
  if (typeof localStorage === 'undefined') return;
  if (token) {
    localStorage.setItem('zhin_api_token', token);
    localStorage.setItem('zhin_sandbox_token', token);
    localStorage.setItem('zhin_console_token', token);
  } else {
    localStorage.removeItem('zhin_api_token');
    localStorage.removeItem('zhin_sandbox_token');
    localStorage.removeItem('zhin_console_token');
  }
}
function readStoredToken() {
  if (typeof localStorage === 'undefined') return '';
  return localStorage.getItem('zhin_api_token')
    || localStorage.getItem('zhin_sandbox_token')
    || localStorage.getItem('zhin_console_token')
    || '';
}
if (typeof location !== 'undefined' && typeof location.search === 'string') {
  const urlToken = new URLSearchParams(location.search).get('token')?.trim() || '';
  if (urlToken) {
    storeTokens(urlToken);
    const params = new URLSearchParams(location.search);
    params.delete('token');
    const nextSearch = params.toString();
    if (typeof history !== 'undefined' && typeof history.replaceState === 'function') {
      history.replaceState(null, '', location.pathname + (nextSearch ? '?' + nextSearch : '') + (location.hash || ''));
    }
  }
}
if (tokenInput) tokenInput.value = readStoredToken();
async function checkStatus() {
  if (!statusEl) return;
  if (!${probeAuth ? 'true' : 'false'}) {
    statusEl.textContent = 'ready';
    return;
  }
  try {
    const token = readStoredToken();
    const headers = token ? { Authorization: 'Bearer ' + token } : {};
    const res = await fetch('/console/api/pages', { headers });
    statusEl.textContent = res.ok ? 'connected' : (res.status === 401 || res.status === 403 ? 'auth required' : 'ready');
  } catch {
    statusEl.textContent = 'ready';
  }
}
void checkStatus();
if (tokenForm && tokenInput) {
  tokenForm.addEventListener('submit', (event) => {
    event.preventDefault();
    storeTokens(tokenInput.value.trim());
    window.dispatchEvent(new CustomEvent('zhin:auth-changed'));
    location.reload();
  });
}
if (tokenClear && tokenInput) {
  tokenClear.addEventListener('click', () => {
    tokenInput.value = '';
    storeTokens('');
    window.dispatchEvent(new CustomEvent('zhin:auth-changed'));
    location.reload();
  });
}
</script>`;
}

function sandboxFallbackScript(): string {
  return `<script type="module">
const root = document.getElementById('app') || document.getElementById('root');
root.innerHTML = \`
  <div class="sandbox-shell" id="sandbox-fallback">
    <div class="sandbox-toolbar">
      <div class="scene-tabs" id="scene-switcher">
        <button type="button" class="scene-tab active" data-scene="private">私聊 (private)</button>
        <button type="button" class="scene-tab" data-scene="group">群聊 (group)</button>
        <button type="button" class="scene-tab" data-scene="channel">频道 (channel)</button>
        <input id="channel-id-input" value="sandbox-user" title="会话 ID" style="width: 120px" />
        <code id="channel-name">private:sandbox-user</code>
      </div>
      <div class="sender-bar" id="sender-switcher">
        <input id="sender-id-input" value="dev-user" placeholder="senderId" title="发送者 ID" style="width: 96px" />
        <input id="sender-name-input" value="Developer" placeholder="senderName" title="发送者名称" style="width: 100px" />
        <select id="sender-role-select" title="发送者角色">
          <option value="master">master</option>
          <option value="admin">admin</option>
          <option value="member">member</option>
        </select>
      </div>
    </div>
    <div class="log" id="chat-messages"></div>
    <div class="quick-bar" id="quick-commands">
      <span class="text-xs text-muted-foreground">快捷指令:</span>
      <button type="button" class="quick-chip" data-quick-cmd="help">help</button>
      <button type="button" class="quick-chip" data-quick-cmd="ping">ping</button>
      <button type="button" class="quick-chip" data-quick-cmd="status">status</button>
    </div>
    <form class="composer" id="chat-form">
      <input id="chat-input" placeholder="发送到 /sandbox …" autocomplete="off" />
      <button type="submit">发送</button>
    </form>
  </div>
\`;
const log = document.getElementById('chat-messages');
const status = document.getElementById('ws-status');
const form = document.getElementById('chat-form');
const input = document.getElementById('chat-input');
const tokenForm = document.getElementById('token-form');
const tokenInput = document.getElementById('token-input');
const tokenClear = document.getElementById('token-clear');
const channelNameEl = document.getElementById('channel-name');
const channelIdInput = document.getElementById('channel-id-input');
const senderIdInput = document.getElementById('sender-id-input');
const senderNameInput = document.getElementById('sender-name-input');
const senderRoleSelect = document.getElementById('sender-role-select');
const sceneButtons = Array.from(document.querySelectorAll('[data-scene]'));
const quickButtons = Array.from(document.querySelectorAll('[data-quick-cmd]'));

let currentScene = 'private';
let currentChannelId = 'sandbox-user';
const defaultChannelByScene = {
  private: 'sandbox-user',
  group: 'dev-group-1',
  channel: 'dev-channel-1',
};

function updateChannelBadge(notifySubscribe = true) {
  currentChannelId = (channelIdInput?.value || '').trim() || defaultChannelByScene[currentScene] || 'sandbox-user';
  if (channelNameEl) {
    channelNameEl.textContent = currentScene + ':' + currentChannelId;
  }
  for (const btn of sceneButtons) {
    btn.classList.toggle('active', btn.getAttribute('data-scene') === currentScene);
  }
  if (notifySubscribe && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ op: 'subscribe', conversation: { type: currentScene, id: currentChannelId } }));
  }
}

for (const btn of sceneButtons) {
  btn.addEventListener('click', () => {
    const nextScene = btn.getAttribute('data-scene') || 'private';
    const prevDefault = defaultChannelByScene[currentScene];
    currentScene = nextScene;
    if (channelIdInput && (!channelIdInput.value.trim() || channelIdInput.value.trim() === prevDefault)) {
      channelIdInput.value = defaultChannelByScene[currentScene] || 'sandbox-user';
    }
    updateChannelBadge(true);
  });
}
if (channelIdInput) {
  channelIdInput.addEventListener('change', () => updateChannelBadge(true));
  channelIdInput.addEventListener('input', () => updateChannelBadge(false));
}

function storeTokens(token) {
  if (typeof localStorage === 'undefined' || typeof localStorage.setItem !== 'function') return;
  if (token) {
    localStorage.setItem('zhin_api_token', token);
    localStorage.setItem('zhin_sandbox_token', token);
    localStorage.setItem('zhin_console_token', token);
  } else {
    localStorage.removeItem('zhin_api_token');
    localStorage.removeItem('zhin_sandbox_token');
    localStorage.removeItem('zhin_console_token');
  }
}

function resolveSandboxWsUrl() {
  // Prefer the stored Host base (Remote Console) over page origin, then
  // flip http(s) → ws(s) from the *resolved base*, not location.protocol —
  // otherwise a https UI page + http Host would produce wss://http-host and fail.
  const urlToken = typeof location !== 'undefined' && typeof location.search === 'string'
    ? new URLSearchParams(location.search).get('token')?.trim() || ''
    : '';
  if (urlToken) {
    storeTokens(urlToken);
  }
  const storedToken = (typeof localStorage !== 'undefined' && (localStorage.getItem('zhin_api_token') || localStorage.getItem('zhin_sandbox_token')))
    || (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('zhin_api_token'))
    || '';
  const token = (typeof window !== 'undefined' && window.__ZHIN_API_TOKEN)
    || urlToken
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

if (typeof location !== 'undefined' && typeof location.search === 'string' && new URLSearchParams(location.search).has('token')) {
  const params = new URLSearchParams(location.search);
  const t = params.get('token')?.trim();
  if (t) storeTokens(t);
  params.delete('token');
  const nextSearch = params.toString();
  if (typeof history !== 'undefined' && typeof history.replaceState === 'function') {
    history.replaceState(null, '', location.pathname + (nextSearch ? '?' + nextSearch : '') + (location.hash || ''));
  }
}
if (tokenInput && typeof localStorage !== 'undefined') {
  tokenInput.value = localStorage.getItem('zhin_api_token') || localStorage.getItem('zhin_sandbox_token') || '';
}

function escapeClientHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function renderMarkdownHtml(raw) {
  let html = escapeClientHtml(raw);
  html = html.replace(/\`\`\`([a-zA-Z0-9_-]*)\\n([\\s\\S]*?)\`\`\`/g, (_m, _lang, code) => '<pre class="segment-code"><code>' + code + '</code></pre>');
  html = html.replace(/\`([^\`\\n]+)\`/g, '<code>$1</code>');
  html = html.replace(/\\*\\*([^*\\n]+)\\*\\*/g, '<strong>$1</strong>');
  html = html.replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^)\\s]+)\\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  return '<div class="segment-markdown">' + html + '</div>';
}

function resolveMediaSource(data) {
  const raw = data?.url || data?.file || data?.src || (data?.media && typeof data.media === 'object' ? data.media.value : '');
  const str = String(raw || '').trim();
  if (!str) return '';
  if (str.startsWith('base64://')) {
    const rest = str.slice('base64://'.length);
    return rest.includes(';base64,') ? 'data:' + rest : 'data:image/png;base64,' + rest;
  }
  return str;
}

function createActionButtonsHtml(buttons) {
  if (!Array.isArray(buttons) || buttons.length === 0) return '';
  const items = buttons.map((btn) => {
    if (!btn || typeof btn !== 'object') return '';
    const label = escapeClientHtml(btn.label ?? btn.text ?? btn.title ?? btn.id ?? btn.value ?? 'Action');
    const payload = escapeClientHtml(btn.value ?? btn.payload ?? btn.data ?? btn.action ?? btn.text ?? btn.label ?? btn.id ?? '');
    return '<button type="button" class="sandbox-action-btn" data-action-payload="' + payload + '">' + label + '</button>';
  }).filter(Boolean).join('');
  return items ? '<div class="segment-actions">' + items + '</div>' : '';
}

function renderSegmentsHtml(content, fallbackText) {
  if (!Array.isArray(content)) {
    return escapeClientHtml(content ?? fallbackText ?? '');
  }
  return content.map((segment) => {
    if (typeof segment === 'string') return escapeClientHtml(segment);
    if (!segment || typeof segment !== 'object') return '';
    const type = String(segment.type || 'text');
    const d = segment.data && typeof segment.data === 'object' ? segment.data : {};
    switch (type) {
      case 'text':
        return escapeClientHtml(d.text ?? d.content ?? '');
      case 'markdown':
      case 'md':
        return renderMarkdownHtml(d.content ?? d.text ?? '');
      case 'code':
        return '<pre class="segment-code"><code>' + escapeClientHtml(d.code ?? d.text ?? d.content ?? '') + '</code></pre>';
      case 'image': {
        const src = resolveMediaSource(d);
        return src
          ? '<img class="segment-image" src="' + escapeClientHtml(src) + '" alt="image" />'
          : '<span class="route-badge">[图片]</span>';
      }
      case 'audio':
      case 'record': {
        const src = resolveMediaSource(d);
        return src ? '<audio controls src="' + escapeClientHtml(src) + '"></audio>' : '<span class="route-badge">[音频]</span>';
      }
      case 'video': {
        const src = resolveMediaSource(d);
        return src ? '<video controls class="segment-image" src="' + escapeClientHtml(src) + '"></video>' : '<span class="route-badge">[视频]</span>';
      }
      case 'mention':
      case 'at':
        return '<code>@' + escapeClientHtml(d.name ?? d.target ?? d.qq ?? d.id ?? '') + '</code>';
      case 'reply':
        return '<div class="text-xs text-muted-foreground">↩ 引用 #' + escapeClientHtml(d.message_id ?? d.id ?? '') + '</div>';
      case 'html': {
        const rawHtml = String(d.html ?? d.content ?? '');
        return '<iframe class="segment-html" sandbox="" srcdoc="' + escapeClientHtml(rawHtml) + '"></iframe>';
      }
      case 'card': {
        const title = d.title ? '<div class="segment-card-title">' + escapeClientHtml(d.title) + '</div>' : '';
        const desc = (d.description ?? d.content ?? d.text)
          ? '<div class="segment-card-desc">' + renderMarkdownHtml(d.description ?? d.content ?? d.text) + '</div>'
          : '';
        const fields = Array.isArray(d.fields) && d.fields.length > 0
          ? '<div class="segment-card-fields">' + d.fields.map((f) => (
            '<div><strong>' + escapeClientHtml(f?.name ?? f?.label ?? '') + ':</strong> ' + escapeClientHtml(f?.value ?? '') + '</div>'
          )).join('') + '</div>'
          : '';
        const buttons = createActionButtonsHtml(d.buttons);
        return '<div class="segment-card">' + title + desc + fields + buttons + '</div>';
      }
      case 'button':
        return createActionButtonsHtml(Array.isArray(d.buttons) ? d.buttons : [d]);
      case 'keyboard': {
        const rows = Array.isArray(d.rows) ? d.rows.flat() : (Array.isArray(d.buttons) ? d.buttons : []);
        return createActionButtonsHtml(rows);
      }
      default:
        return d.text || d.content ? escapeClientHtml(d.text ?? d.content) : '<span class="route-badge">[' + escapeClientHtml(type) + ']</span>';
    }
  }).join('\\n');
}

function findBubbleByMessageId(messageId) {
  if (!messageId || !log) return null;
  const bubbles = log.querySelectorAll('[data-message-id]');
  for (const el of bubbles) {
    if (el.getAttribute('data-message-id') === String(messageId)) return el;
  }
  return null;
}

function upsertBubble(kind, data, fallbackText) {
  if (!log) return;
  const messageId = data && typeof data === 'object' ? (data.messageId || '') : '';
  const isEdit = data && typeof data === 'object' && (data.type === 'edit' || (kind === 'in' && Boolean(messageId) && findBubbleByMessageId(messageId)));
  const html = data && typeof data === 'object' && ('content' in data)
    ? renderSegmentsHtml(data.content, fallbackText)
    : escapeClientHtml(fallbackText);
  if (isEdit && messageId) {
    const existing = findBubbleByMessageId(messageId);
    if (existing) {
      const body = existing.querySelector('.bubble-body') || existing;
      body.innerHTML = html;
      log.scrollTop = log.scrollHeight;
      return;
    }
  }
  const el = document.createElement('div');
  el.className = 'bubble ' + kind;
  if (messageId) {
    el.setAttribute('data-message-id', String(messageId));
  }
  const body = document.createElement('div');
  body.className = 'bubble-body';
  body.innerHTML = html;
  el.appendChild(body);
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
}

function sendOutboundText(text, isAction = false) {
  if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
  const senderId = (senderIdInput?.value || '').trim() || 'dev-user';
  const senderName = (senderNameInput?.value || '').trim() || 'Developer';
  const senderRole = senderRoleSelect?.value || 'master';
  const messageId = 'msg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
  const content = isAction
    ? [{ type: 'action', data: { id: text, payload: text } }, { type: 'text', data: { text } }]
    : [{ type: 'text', data: { text } }];
  ws.send(JSON.stringify({
    type: currentScene,
    id: currentChannelId,
    messageId,
    content,
    text,
    senderId,
    senderName,
    senderRole,
    timestamp: Date.now(),
  }));
  upsertBubble('out', { messageId, content: [{ type: 'text', data: { text } }] }, text);
}

if (log) {
  log.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('[data-action-payload]') : null;
    if (!target) return;
    const payload = target.getAttribute('data-action-payload') || '';
    if (payload) sendOutboundText(payload, true);
  });
}

for (const chip of quickButtons) {
  chip.addEventListener('click', () => {
    const cmd = chip.getAttribute('data-quick-cmd') || '';
    if (cmd) sendOutboundText(cmd, false);
  });
}

let ws;
function connectWs() {
  if (ws) {
    try { ws.close(); } catch {}
  }
  status.textContent = 'connecting…';
  ws = new WebSocket(resolveSandboxWsUrl());
  ws.addEventListener('open', () => {
    status.textContent = 'connected';
    updateChannelBadge(true);
  });
  ws.addEventListener('close', () => { status.textContent = 'disconnected'; });
  ws.addEventListener('error', () => { status.textContent = 'error (请在右上角输入 .env 中的 HTTP_TOKEN 后重连)'; });
  ws.addEventListener('message', (event) => {
    try {
      const data = JSON.parse(String(event.data));
      if (data.type === 'subscribed') return;
      if (data.direction === 'inbound') return;
      const text = Array.isArray(data.content)
        ? data.content.map((s) => s?.data?.text ?? s?.data?.content ?? '').filter(Boolean).join('\\n')
        : String(data.content ?? event.data);
      upsertBubble('in', data, text || String(event.data));
    } catch {
      upsertBubble('in', null, String(event.data));
    }
  });
}
connectWs();
if (tokenForm && tokenInput) {
  tokenForm.addEventListener('submit', (event) => {
    event.preventDefault();
    storeTokens(tokenInput.value.trim());
    connectWs();
  });
}
if (tokenClear && tokenInput) {
  tokenClear.addEventListener('click', () => {
    tokenInput.value = '';
    storeTokens('');
    connectWs();
  });
}
form.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
  sendOutboundText(text, false);
  input.value = '';
});
</script>`;
}

function pageModuleScript(moduleUrl: string, page: PageShellDescriptor): string {
  const entryMeta = JSON.stringify({
    pluginId: page.owner ?? '',
    owner: page.owner ?? '',
    localName: page.localName,
    route: page.route,
    title: page.title,
  });
  return `${standaloneTokenBootstrapScript(true)}
<script type="module">
import * as ReactModule from 'react';
import * as JsxRuntimeModule from 'react/jsx-runtime';
import * as ReactDomClientModule from 'react-dom/client';

const React = ReactModule.default ?? ReactModule;
const { createElement } = ReactModule;
const { createRoot } = ReactDomClientModule;

const shared = globalThis.__ZHIN_CONSOLE_SHARED_MODULES__ instanceof Map
  ? globalThis.__ZHIN_CONSOLE_SHARED_MODULES__
  : new Map();
globalThis.__ZHIN_CONSOLE_SHARED_MODULES__ = shared;
globalThis.__ZHIN_CONSOLE_HOST_REACT_NAMESPACE__ = React;
shared.set('react', React);
shared.set('react/jsx-runtime', JsxRuntimeModule.default ?? JsxRuntimeModule);
shared.set('react/jsx-dev-runtime', JsxRuntimeModule.default ?? JsxRuntimeModule);
shared.set('react-dom', ReactDomClientModule.default ?? ReactDomClientModule);
shared.set('react-dom/client', ReactDomClientModule.default ?? ReactDomClientModule);

let RouterWrapper = null;
try {
  const routerDom = await import('react-router-dom');
  shared.set('react-router', routerDom);
  shared.set('react-router-dom', routerDom);
  RouterWrapper = routerDom.BrowserRouter ?? null;
} catch {}

const entry = ${entryMeta};
const mount = document.getElementById('app') || document.getElementById('root');
if (entry.owner) {
  globalThis.__ZHIN_ACTIVE_PLUGIN_ID__ = entry.owner;
  mount?.setAttribute('data-zhin-plugin-id', entry.owner);
}

class PageErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return createElement('div', { className: 'zhin-error-boundary', role: 'alert' },
        createElement('h3', null, '页面渲染异常 (' + (entry.title || entry.route) + ')'),
        createElement('pre', { className: 'segment-code' }, String(this.state.error?.stack || this.state.error?.message || this.state.error)),
      );
    }
    return this.props.children;
  }
}

try {
  const page = await import(${JSON.stringify(moduleUrl)});
  let Component = page.default ?? page.SandboxPage ?? null;
  let registeredElement = null;
  if (!Component && typeof page.register === 'function') {
    page.register({
      React,
      addRoute(routeRecord) { registeredElement = routeRecord?.element ?? null; },
      addTool() { return entry.localName; },
    });
  }
  const content = registeredElement ?? createElement(Component ?? page, entry);
  const wrapped = RouterWrapper ? createElement(RouterWrapper, null, content) : content;
  createRoot(mount).render(createElement(PageErrorBoundary, null, wrapped));
} catch (error) {
  if (mount) {
    mount.innerHTML = '<div class="zhin-error-boundary" role="alert"><h3>页面模块加载失败</h3><pre class="segment-code">'
      + String(error?.stack || error?.message || error).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      + '</pre></div>';
  }
}
</script>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
