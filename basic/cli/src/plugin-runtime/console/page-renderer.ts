import {
  type ConsoleIndexPage,
  type PageShellDescriptor,
  escapeHtml,
  inferPageCategory,
  pageModuleScript,
  sandboxFallbackScript,
  standaloneTokenBootstrapScript,
} from './page-renderer-helpers.js';

export type { ConsoleIndexPage, PageShellDescriptor } from './page-renderer-helpers.js';

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
