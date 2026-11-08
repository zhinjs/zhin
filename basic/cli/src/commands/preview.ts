import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, watch, type FSWatcher } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseComponentDefinition, type ComponentDefinition } from '@zhin.js/component';
import {
  isConsoleBlueprint,
  projectBlueprintToCliPanel,
  projectBlueprintToImCard,
} from '@zhin.js/pagemanager';
import { renderToSegments } from '@zhin.js/core/runtime';

export interface DiscoveredComponentPreview {
  readonly id: string;
  readonly name: string;
  readonly owner: string;
  readonly source: string;
  readonly previewProps: unknown;
  readonly html: string;
  readonly segments: readonly unknown[];
  readonly error?: string;
}

export interface DiscoveredPagePreview {
  readonly id: string;
  readonly name: string;
  readonly owner: string;
  readonly source: string;
  readonly kind: 'blueprint' | 'adapter' | 'review' | 'declarative' | 'custom-module';
  readonly title: string;
  readonly description?: string;
  readonly imCard?: unknown;
  readonly cliPanel?: string;
  readonly error?: string;
}

export interface ProjectPreviewSnapshot {
  readonly projectRoot: string;
  readonly projectName: string;
  readonly generatedAt: number;
  readonly components: readonly DiscoveredComponentPreview[];
  readonly pages: readonly DiscoveredPagePreview[];
}

const ENTRY_FILES = ['index.tsx', 'index.ts', 'index.js', 'index.mjs'] as const;
const LAYOUT_SLOTS = new Set(['nav', 'footer', 'header', 'sidebar']);

async function findCapabilityEntries(baseDir: string): Promise<{ name: string; filePath: string }[]> {
  if (!existsSync(baseDir)) return [];
  const entries = await readdir(baseDir, { withFileTypes: true }).catch(() => []);
  const results: { name: string; filePath: string }[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    for (const fileName of ENTRY_FILES) {
      const candidate = join(baseDir, entry.name, fileName);
      if (existsSync(candidate)) {
        results.push({ name: entry.name, filePath: candidate });
        break;
      }
    }
  }
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

async function discoverCandidateRoots(projectRoot: string): Promise<{ owner: string; rootDir: string }[]> {
  const roots: { owner: string; rootDir: string }[] = [];
  let rootName = 'root';
  const pkgPath = join(projectRoot, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(await readFile(pkgPath, 'utf8')) as { name?: string };
      if (pkg.name) rootName = pkg.name;
    } catch { /* ignore */ }
  }
  roots.push({ owner: rootName, rootDir: projectRoot });

  const pluginsDir = join(projectRoot, 'plugins');
  if (existsSync(pluginsDir)) {
    const children = await readdir(pluginsDir, { withFileTypes: true }).catch(() => []);
    for (const child of children) {
      if (!child.isDirectory()) continue;
      const subDir = join(pluginsDir, child.name);
      roots.push({ owner: `plugins/${child.name}`, rootDir: subDir });
    }
  }
  return roots;
}

async function renderComponentNodeToPreview(
  definition: ComponentDefinition<any>,
  props: unknown,
  allDefinitions: ReadonlyMap<string, ComponentDefinition<any>>,
): Promise<{ html: string; segments: readonly unknown[] }> {
  const renderNested = async (name: string, nestedProps: Record<string, unknown>) => {
    const nested = allDefinitions.get(name);
    if (!nested) throw new Error(`未找到嵌套组件 <${name} />`);
    return await nested.render(nestedProps as never, {
      requester: {} as never,
      signal: new AbortController().signal,
    } as never);
  };

  const rawNode = await definition.render((props ?? {}) as never, {
    requester: {} as never,
    signal: new AbortController().signal,
  } as never);

  let segments: readonly any[];
  try {
    segments = await renderToSegments(rawNode as never, {
      renderComponent: renderNested as never,
      bindButton: (btnProps: { label?: unknown; action?: string; id?: string; variant?: string }) => ({
        type: 'button',
        data: {
          id: btnProps.id ?? btnProps.action ?? 'preview-btn',
          label: String(btnProps.label ?? 'Button'),
          variant: btnProps.variant ?? 'secondary',
        },
      }),
    });
  } catch (err) {
    // If the user returned <CardCanvas>...</CardCanvas> directly without wrapping in <html>...</html>,
    // automatically wrap it in an explicit HTML boundary for preview convenience.
    if (err instanceof Error && /Unknown message tag/i.test(err.message)) {
      const wrappedHtmlElement = Object.freeze({
        $jsx: 'zhin.jsx/1' as const,
        type: 'html',
        props: Object.freeze({ children: rawNode }),
      });
      segments = await renderToSegments(wrappedHtmlElement as never, {
        renderComponent: renderNested as never,
      });
    } else {
      throw err;
    }
  }

  const htmlParts: string[] = [];
  for (const seg of segments) {
    if (seg?.type === 'html' && typeof seg.data?.html === 'string') {
      htmlParts.push(seg.data.html);
    } else if (seg?.type === 'text' && typeof seg.data?.text === 'string') {
      htmlParts.push(
        `<div style="padding:12px 16px;background:#ffffff;border:1px solid rgba(0,0,0,0.08);border-radius:10px;font-family:system-ui,sans-serif;font-size:14px;color:#111827;white-space:pre-wrap">${escapeHtmlText(seg.data.text)}</div>`
      );
    } else if (seg?.type === 'markdown' && typeof seg.data?.content === 'string') {
      htmlParts.push(
        `<div style="padding:12px 16px;background:#ffffff;border:1px solid rgba(0,0,0,0.08);border-radius:10px;font-family:ui-monospace,monospace;font-size:13px;color:#111827;white-space:pre-wrap">${escapeHtmlText(seg.data.content)}</div>`
      );
    }
  }

  return {
    html: htmlParts.join('\n'),
    segments,
  };
}

function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function buildProjectPreviewSnapshot(
  projectRootInput: string,
  customComponentProps: ReadonlyMap<string, unknown> = new Map(),
  customPageData: ReadonlyMap<string, Record<string, unknown>> = new Map(),
): Promise<ProjectPreviewSnapshot> {
  const projectRoot = resolve(projectRootInput);
  const roots = await discoverCandidateRoots(projectRoot);
  const projectName = roots[0]?.owner ?? 'zhin-project';

  const tsconfigFile = join(projectRoot, 'tsconfig.json');
  const { register } = await import('tsx/esm/api');
  const scoped = register({
    namespace: `zhin-preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    tsconfig: existsSync(tsconfigFile) ? tsconfigFile : false,
  });

  try {
    const loadedComponents: {
      id: string;
      name: string;
      owner: string;
      source: string;
      definition?: ComponentDefinition<any>;
      loadError?: string;
    }[] = [];
    const definitionMap = new Map<string, ComponentDefinition<any>>();

    for (const { owner, rootDir } of roots) {
      const compEntries = await findCapabilityEntries(join(rootDir, 'components'));
      for (const entry of compEntries) {
        const relSource = relative(projectRoot, entry.filePath).replace(/\\/g, '/');
        const id = `${owner}:${entry.name}`;
        try {
          const mod = (await scoped.import(pathToFileURL(entry.filePath).href, pathToFileURL(projectRoot + '/').href)) as {
            default?: unknown;
          };
          const def = parseComponentDefinition(mod.default);
          loadedComponents.push({ id, name: entry.name, owner, source: relSource, definition: def });
          definitionMap.set(entry.name, def);
        } catch (err) {
          loadedComponents.push({
            id,
            name: entry.name,
            owner,
            source: relSource,
            loadError: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    const components: DiscoveredComponentPreview[] = [];
    for (const item of loadedComponents) {
      if (!item.definition) {
        components.push({
          id: item.id,
          name: item.name,
          owner: item.owner,
          source: item.source,
          previewProps: {},
          html: '',
          segments: [],
          error: item.loadError ?? '组件加载失败',
        });
        continue;
      }
      const effectiveProps = customComponentProps.has(item.id)
        ? customComponentProps.get(item.id)
        : (item.definition.previewProps ?? {});
      try {
        const rendered = await renderComponentNodeToPreview(item.definition, effectiveProps, definitionMap);
        components.push({
          id: item.id,
          name: item.name,
          owner: item.owner,
          source: item.source,
          previewProps: effectiveProps,
          html: rendered.html,
          segments: rendered.segments,
        });
      } catch (err) {
        components.push({
          id: item.id,
          name: item.name,
          owner: item.owner,
          source: item.source,
          previewProps: effectiveProps,
          html: '',
          segments: [],
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const pages: DiscoveredPagePreview[] = [];
    for (const { owner, rootDir } of roots) {
      const pageEntries = await findCapabilityEntries(join(rootDir, 'pages'));
      for (const entry of pageEntries) {
        if (LAYOUT_SLOTS.has(entry.name)) continue;
        const relSource = relative(projectRoot, entry.filePath).replace(/\\/g, '/');
        const id = `${owner}:${entry.name}`;
        try {
          const mod = (await scoped.import(pathToFileURL(entry.filePath).href, pathToFileURL(projectRoot + '/').href)) as {
            default?: unknown;
            blueprint?: unknown;
            meta?: { title?: string; description?: string };
          };
          const exported = mod.blueprint ?? mod.default;
          const mockData = customPageData.get(id) ?? {};
          const exportedObj =
            exported && (typeof exported === 'object' || typeof exported === 'function')
              ? (exported as { kind?: unknown; reviewSpec?: unknown })
              : undefined;
          if (isConsoleBlueprint(exported)) {
            const kind =
              exportedObj?.kind === 'zhin.console.adapter-page'
                ? 'adapter'
                : exportedObj?.reviewSpec !== undefined
                  ? 'review'
                  : 'blueprint';
            const imCard = projectBlueprintToImCard(exported as never, mockData, { locale: 'zh-CN' });
            const cliPanel = projectBlueprintToCliPanel(exported as never, mockData, { locale: 'zh-CN', width: 76 });
            pages.push({
              id,
              name: entry.name,
              owner,
              source: relSource,
              kind,
              title: imCard.title || mod.meta?.title || entry.name,
              description: imCard.description ?? mod.meta?.description,
              imCard,
              cliPanel,
            });
          } else {
            pages.push({
              id,
              name: entry.name,
              owner,
              source: relSource,
              kind: 'custom-module',
              title: mod.meta?.title ?? entry.name,
              description: mod.meta?.description ?? '自定义客户端页面模块',
            });
          }
        } catch (err) {
          pages.push({
            id,
            name: entry.name,
            owner,
            source: relSource,
            kind: 'custom-module',
            title: entry.name,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    return {
      projectRoot,
      projectName,
      generatedAt: Date.now(),
      components,
      pages,
    };
  } finally {
    await scoped.unregister().catch(() => undefined);
  }
}

export function renderPreviewWorkbenchHtml(snapshot: ProjectPreviewSnapshot, liveServer: boolean): string {
  const serializedSnapshot = JSON.stringify(snapshot).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtmlText(snapshot.projectName)} · Zhin 组件与页面预览工作台</title>
  <style>
    :root {
      --bg: #f1f5f9;
      --surface: #ffffff;
      --surface-muted: #f8fafc;
      --border: #e2e8f0;
      --text: #0f172a;
      --text-secondary: #475569;
      --text-muted: #64748b;
      --primary: #2563eb;
      --primary-soft: #eff6ff;
      --danger: #dc2626;
      --danger-soft: #fef2f2;
      --success: #10b981;
    }
    body.dark {
      --bg: #0b1120;
      --surface: #111827;
      --surface-muted: #1e293b;
      --border: #334155;
      --text: #f8fafc;
      --text-secondary: #cbd5e1;
      --text-muted: #94a3b8;
      --primary: #3b82f6;
      --primary-soft: rgba(59, 130, 246, 0.16);
      --danger: #f87171;
      --danger-soft: rgba(239, 68, 68, 0.16);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif;
      font-size: 13px;
      line-height: 1.5;
    }
    .topbar {
      position: sticky;
      top: 0;
      z-index: 100;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 12px;
      padding: 10px 20px;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      box-shadow: 0 2px 10px rgba(15, 23, 42, 0.04);
    }
    .brand {
      font-weight: 700;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 600;
      background: var(--primary-soft);
      color: var(--primary);
    }
    .tabs {
      display: inline-flex;
      background: var(--surface-muted);
      padding: 3px;
      border-radius: 8px;
      border: 1px solid var(--border);
    }
    .tab-btn {
      border: 0;
      background: transparent;
      color: var(--text-secondary);
      padding: 5px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }
    .tab-btn.active {
      background: var(--surface);
      color: var(--text);
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
    }
    .controls {
      margin-left: auto;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 10px;
    }
    select, button.ctrl-btn {
      background: var(--surface-muted);
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 5px 10px;
      font-size: 12px;
      cursor: pointer;
    }
    button.ctrl-btn.active {
      background: var(--primary);
      color: #fff;
      border-color: var(--primary);
    }
    .workspace {
      display: grid;
      grid-template-columns: 260px minmax(0, 1fr) 340px;
      min-height: calc(100vh - 53px);
    }
    @media (max-width: 1100px) {
      .workspace { grid-template-columns: 220px minmax(0, 1fr); }
      .inspector { grid-column: 1 / -1; border-left: 0 !important; border-top: 1px solid var(--border); }
    }
    @media (max-width: 720px) {
      .workspace { grid-template-columns: 1fr; }
      .sidebar { border-right: 0 !important; border-bottom: 1px solid var(--border); }
    }
    .sidebar {
      background: var(--surface);
      border-right: 1px solid var(--border);
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .sidebar-title {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      padding: 4px 6px;
    }
    .item-btn {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 2px;
      width: 100%;
      text-align: left;
      padding: 8px 10px;
      border-radius: 8px;
      border: 1px solid transparent;
      background: transparent;
      color: var(--text);
      cursor: pointer;
    }
    .item-btn:hover { background: var(--surface-muted); }
    .item-btn.active {
      background: var(--primary-soft);
      border-color: rgba(37, 99, 235, 0.28);
      color: var(--primary);
    }
    .item-btn small {
      font-size: 11px;
      color: var(--text-muted);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .stage {
      padding: 24px;
      display: flex;
      flex-direction: column;
      align-items: center;
      overflow: auto;
    }
    .stage-canvas {
      width: 100%;
      display: flex;
      justify-content: center;
      padding: 24px;
      border-radius: 14px;
      border: 1px solid var(--border);
      background: #e2e8f0;
      transition: max-width 0.2s ease, background 0.2s ease;
    }
    .stage-canvas.bg-dark { background: #0f172a; }
    .stage-canvas.bg-grid {
      background-color: #f8fafc;
      background-image: linear-gradient(45deg, #e2e8f0 25%, transparent 25%), linear-gradient(-45deg, #e2e8f0 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e2e8f0 75%), linear-gradient(-45deg, transparent 75%, #e2e8f0 75%);
      background-size: 16px 16px;
      background-position: 0 0, 0 8px, 8px -8px, -8px 0;
    }
    .inspector {
      background: var(--surface);
      border-left: 1px solid var(--border);
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .inspector h3 {
      margin: 0;
      font-size: 14px;
    }
    textarea.props-editor {
      width: 100%;
      min-height: 180px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      padding: 10px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--surface-muted);
      color: var(--text);
      resize: vertical;
    }
    pre.code-box {
      margin: 0;
      padding: 12px;
      border-radius: 8px;
      background: #0f172a;
      color: #e2e8f0;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11.5px;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .error-banner {
      width: 100%;
      padding: 14px 16px;
      border-radius: 10px;
      background: var(--danger-soft);
      color: var(--danger);
      border: 1px solid rgba(220, 38, 38, 0.3);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px;
      white-space: pre-wrap;
    }
    .empty-box {
      padding: 40px 24px;
      text-align: center;
      color: var(--text-muted);
      background: var(--surface);
      border: 1px dashed var(--border);
      border-radius: 12px;
      max-width: 520px;
    }
    .blueprint-grid {
      width: 100%;
      max-width: 960px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .bp-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px 20px;
    }
    .bp-stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 12px;
      margin-top: 12px;
    }
    .bp-stat {
      padding: 12px 14px;
      border-radius: 10px;
      background: var(--surface-muted);
      border: 1px solid var(--border);
    }
    .bp-stat-label { font-size: 11px; color: var(--text-muted); }
    .bp-stat-val { font-size: 20px; font-weight: 700; margin-top: 2px; }
    table.bp-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
      font-size: 12px;
    }
    table.bp-table th, table.bp-table td {
      padding: 8px 10px;
      border-bottom: 1px solid var(--border);
      text-align: left;
    }
    table.bp-table th { color: var(--text-muted); font-weight: 600; background: var(--surface-muted); }
    body.debug-outlines .preview-render-root * {
      outline: 1px dashed rgba(236, 72, 153, 0.5) !important;
    }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="brand">
      <span>⚡ Zhin 本地预览工作台</span>
      <span class="badge" id="project-badge"></span>
    </div>
    <div class="tabs">
      <button type="button" class="tab-btn active" data-tab="components" id="tab-components"></button>
      <button type="button" class="tab-btn" data-tab="pages" id="tab-pages"></button>
    </div>
    <div class="controls">
      <label>画布宽度：
        <select id="ctrl-width">
          <option value="100%">自适应 (100%)</option>
          <option value="420px">紧凑卡片 (420px)</option>
          <option value="540px" selected>标准 IM 图卡 (540px)</option>
          <option value="680px">宽幅图卡 (680px)</option>
          <option value="920px">桌面宽屏 (920px)</option>
        </select>
      </label>
      <label>画布底色：
        <select id="ctrl-bg">
          <option value="light">浅灰画布</option>
          <option value="dark">深色画布</option>
          <option value="grid">透明棋盘格</option>
        </select>
      </label>
      <button type="button" class="ctrl-btn" id="ctrl-outline">📐 盒模型/间距辅助线</button>
      <button type="button" class="ctrl-btn" id="ctrl-dark">🌙 界面深色</button>
      ${liveServer ? '<span class="badge" id="live-status">● 热重载已连接</span>' : ''}
    </div>
  </header>

  <main class="workspace">
    <aside class="sidebar" id="sidebar"></aside>
    <section class="stage" id="stage"></section>
    <aside class="inspector" id="inspector"></aside>
  </main>

  <script>
    let state = {
      snapshot: ${serializedSnapshot},
      activeTab: 'components',
      selectedCompId: null,
      selectedPageId: null,
      canvasWidth: sessionStorage.getItem('zhin.preview.width') || '540px',
      canvasBg: sessionStorage.getItem('zhin.preview.bg') || 'light',
      outline: sessionStorage.getItem('zhin.preview.outline') === '1',
      darkUi: sessionStorage.getItem('zhin.preview.dark') === '1',
      customPropsText: {},
    };

    if (state.snapshot.components.length === 0 && state.snapshot.pages.length > 0) {
      state.activeTab = 'pages';
    }

    const widthSel = document.getElementById('ctrl-width');
    const bgSel = document.getElementById('ctrl-bg');
    const outlineBtn = document.getElementById('ctrl-outline');
    const darkBtn = document.getElementById('ctrl-dark');
    widthSel.value = state.canvasWidth;
    bgSel.value = state.canvasBg;

    function syncBodyFlags() {
      document.body.classList.toggle('debug-outlines', state.outline);
      document.body.classList.toggle('dark', state.darkUi);
      outlineBtn.classList.toggle('active', state.outline);
      darkBtn.classList.toggle('active', state.darkUi);
    }
    syncBodyFlags();

    function render() {
      const snap = state.snapshot;
      document.getElementById('project-badge').textContent = snap.projectName;
      const tabComp = document.getElementById('tab-components');
      const tabPages = document.getElementById('tab-pages');
      tabComp.textContent = \`IM 组件 (components · \${snap.components.length})\`;
      tabPages.textContent = \`控制台蓝图页 (pages · \${snap.pages.length})\`;
      tabComp.classList.toggle('active', state.activeTab === 'components');
      tabPages.classList.toggle('active', state.activeTab === 'pages');

      const sidebar = document.getElementById('sidebar');
      const stage = document.getElementById('stage');
      const inspector = document.getElementById('inspector');

      if (state.activeTab === 'components') {
        if (!state.selectedCompId || !snap.components.some(c => c.id === state.selectedCompId)) {
          state.selectedCompId = snap.components[0]?.id || null;
        }
        sidebar.innerHTML = '<div class="sidebar-title">项目组件目录 (components/)</div>';
        if (snap.components.length === 0) {
          sidebar.innerHTML += '<div style="padding:8px;color:var(--text-muted)">未发现 components/*/index.tsx</div>';
          stage.innerHTML = '<div class="empty-box"><h3>当前项目暂无自定义 IM 组件</h3><p>在 <code>components/&lt;name&gt;/index.tsx</code> 中导出 <code>defineComponent({ previewProps, render })</code>，保存后将在此处实时预览。</p></div>';
          inspector.innerHTML = '<h3>组件属性调试</h3><p style="color:var(--text-muted)">选择左侧组件后可在线修改 previewProps 实时重渲染。</p>';
          return;
        }
        for (const comp of snap.components) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'item-btn' + (comp.id === state.selectedCompId ? ' active' : '');
          btn.innerHTML = \`<strong>\${comp.name}</strong><small>\${comp.source}</small>\`;
          btn.onclick = () => { state.selectedCompId = comp.id; render(); };
          sidebar.appendChild(btn);
        }

        const current = snap.components.find(c => c.id === state.selectedCompId);
        if (!current) return;

        stage.innerHTML = '';
        const canvas = document.createElement('div');
        canvas.className = 'stage-canvas' + (state.canvasBg === 'dark' ? ' bg-dark' : state.canvasBg === 'grid' ? ' bg-grid' : '');
        canvas.style.maxWidth = state.canvasWidth;
        if (current.error) {
          canvas.innerHTML = \`<div class="error-banner">❌ 组件渲染报错 (\${current.source}):\\n\${current.error}</div>\`;
        } else {
          const wrapper = document.createElement('div');
          wrapper.className = 'preview-render-root';
          wrapper.style.width = '100%';
          wrapper.innerHTML = current.html || '<div style="color:#64748b">（组件返回空内容）</div>';
          canvas.appendChild(wrapper);
        }
        stage.appendChild(canvas);

        const propsText = state.customPropsText[current.id] ?? JSON.stringify(current.previewProps ?? {}, null, 2);
        inspector.innerHTML = \`
          <h3>🛠️ 在线修改 Props 参数</h3>
          <div style="font-size:12px;color:var(--text-muted)">来源：<code>\${current.source}</code></div>
          <textarea class="props-editor" id="props-input" spellcheck="false"></textarea>
          <div style="display:flex;gap:8px">
            <button type="button" class="ctrl-btn active" id="btn-apply-props" style="flex:1">▶ 应用 Props 重渲染</button>
            <button type="button" class="ctrl-btn" id="btn-reset-props">重置</button>
          </div>
          <div id="props-err" style="color:var(--danger);font-size:12px;display:none"></div>
          <details>
            <summary style="cursor:pointer;font-weight:600;margin-bottom:6px">查看生成的消息 Segment JSON</summary>
            <pre class="code-box" id="seg-json"></pre>
          </details>
          <details>
            <summary style="cursor:pointer;font-weight:600;margin-bottom:6px">查看生成的内联样式 HTML</summary>
            <pre class="code-box" id="raw-html"></pre>
          </details>
        \`;
        document.getElementById('props-input').value = propsText;
        document.getElementById('seg-json').textContent = JSON.stringify(current.segments, null, 2);
        document.getElementById('raw-html').textContent = current.html;

        document.getElementById('btn-apply-props').onclick = async () => {
          const raw = document.getElementById('props-input').value;
          state.customPropsText[current.id] = raw;
          const errEl = document.getElementById('props-err');
          try {
            const parsed = JSON.parse(raw);
            errEl.style.display = 'none';
            const res = await fetch('/__api/render-component', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: current.id, props: parsed }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || '渲染失败');
            state.snapshot = data.snapshot;
            render();
          } catch (e) {
            errEl.textContent = e.message || String(e);
            errEl.style.display = 'block';
          }
        };
        document.getElementById('btn-reset-props').onclick = async () => {
          delete state.customPropsText[current.id];
          const res = await fetch('/__api/render-component', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: current.id, reset: true }),
          });
          if (res.ok) {
            const data = await res.json();
            state.snapshot = data.snapshot;
            render();
          }
        };
      } else {
        if (!state.selectedPageId || !snap.pages.some(p => p.id === state.selectedPageId)) {
          state.selectedPageId = snap.pages[0]?.id || null;
        }
        sidebar.innerHTML = '<div class="sidebar-title">项目页面蓝图 (pages/)</div>';
        if (snap.pages.length === 0) {
          sidebar.innerHTML += '<div style="padding:8px;color:var(--text-muted)">未发现 pages/*/index.tsx</div>';
          stage.innerHTML = '<div class="empty-box"><h3>当前项目暂无自定义页面</h3><p>在 <code>pages/&lt;name&gt;/index.ts</code> 中导出 <code>definePageBlueprint(...)</code>，即可在此处同时预览 Web 视图、IM 卡片与 CLI 面板。</p></div>';
          inspector.innerHTML = '<h3>页面数据模拟</h3>';
          return;
        }
        for (const pg of snap.pages) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'item-btn' + (pg.id === state.selectedPageId ? ' active' : '');
          btn.innerHTML = \`<strong>\${pg.title || pg.name} <span class="badge">\${pg.kind}</span></strong><small>\${pg.source}</small>\`;
          btn.onclick = () => { state.selectedPageId = pg.id; render(); };
          sidebar.appendChild(btn);
        }

        const current = snap.pages.find(p => p.id === state.selectedPageId);
        if (!current) return;

        if (current.error) {
          stage.innerHTML = \`<div class="error-banner">❌ 页面加载报错 (\${current.source}):\\n\${current.error}</div>\`;
          inspector.innerHTML = '';
          return;
        }

        const card = current.imCard;
        if (!card) {
          stage.innerHTML = \`<div class="empty-box"><h3>\${current.title}</h3><p>来源：<code>\${current.source}</code>（自定义客户端模块）</p></div>\`;
          inspector.innerHTML = '';
          return;
        }

        let statsHtml = '';
        if (card.stats && card.stats.length > 0) {
          statsHtml = '<div class="bp-stats">' + card.stats.map(s => \`
            <div class="bp-stat">
              <div class="bp-stat-label">\${s.label}</div>
              <div class="bp-stat-val">\${s.value}</div>
            </div>
          \`).join('') + '</div>';
        }

        let tablesHtml = '';
        for (const tbl of card.tables || []) {
          const headers = tbl.columns.map(c => \`<th>\${c.label}</th>\`).join('');
          const rows = tbl.rows.length > 0
            ? tbl.rows.map(r => '<tr>' + r.map(cell => \`<td>\${cell}</td>\`).join('') + '</tr>').join('')
            : \`<tr><td colspan="\${tbl.columns.length}" style="text-align:center;color:var(--text-muted)">\${tbl.emptyText || '暂无数据'}</td></tr>\`;
          tablesHtml += \`
            <div class="bp-card">
              <strong>\${tbl.title} (\${tbl.totalRows})</strong>
              <table class="bp-table"><thead><tr>\${headers}</tr></thead><tbody>\${rows}</tbody></table>
            </div>
          \`;
        }

        stage.innerHTML = \`
          <div class="blueprint-grid" style="max-width:\${state.canvasWidth === '540px' ? '920px' : state.canvasWidth}">
            <div class="bp-card">
              <div style="display:flex;justify-content:space-between;align-items:center">
                <div>
                  <h2 style="margin:0;font-size:18px">\${card.title}</h2>
                  \${card.description ? \`<p style="margin:4px 0 0;color:var(--text-secondary)">\${card.description}</p>\` : ''}
                </div>
                <span class="badge">\${current.kind}</span>
              </div>
              \${statsHtml}
            </div>
            \${tablesHtml}
            <div class="bp-card">
              <strong>🖥️ CLI TUI 终端投影预览 (projectBlueprintToCliPanel)</strong>
              <pre class="code-box" style="margin-top:10px">\${current.cliPanel || ''}</pre>
            </div>
          </div>
        \`;

        inspector.innerHTML = \`
          <h3>📄 蓝图多端投影输出</h3>
          <div style="font-size:12px;color:var(--text-muted)">来源：<code>\${current.source}</code></div>
          <details open>
            <summary style="cursor:pointer;font-weight:600;margin-bottom:6px">IM Markdown 投影</summary>
            <pre class="code-box">\${card.markdown || ''}</pre>
          </details>
        \`;
      }
    }

    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.onclick = () => {
        state.activeTab = btn.dataset.tab;
        render();
      };
    });
    widthSel.onchange = () => {
      state.canvasWidth = widthSel.value;
      sessionStorage.setItem('zhin.preview.width', state.canvasWidth);
      render();
    };
    bgSel.onchange = () => {
      state.canvasBg = bgSel.value;
      sessionStorage.setItem('zhin.preview.bg', state.canvasBg);
      render();
    };
    outlineBtn.onclick = () => {
      state.outline = !state.outline;
      sessionStorage.setItem('zhin.preview.outline', state.outline ? '1' : '0');
      syncBodyFlags();
    };
    darkBtn.onclick = () => {
      state.darkUi = !state.darkUi;
      sessionStorage.setItem('zhin.preview.dark', state.darkUi ? '1' : '0');
      syncBodyFlags();
    };

    render();

    ${liveServer ? `
    const es = new EventSource('/__events');
    es.onmessage = (ev) => {
      try {
        const payload = JSON.parse(ev.data);
        if (payload.snapshot) {
          state.snapshot = payload.snapshot;
          render();
        }
      } catch {}
    };
    ` : ''}
  </script>
</body>
</html>`;
}

interface PreviewCommandOptions {
  port: string;
  host: string;
  open?: boolean;
  export?: string;
  json?: boolean;
}

export const previewCommand = new Command('preview')
  .description('启动本地组件与页面蓝图实时预览工作台（自动扫描项目的 components/* 与 pages/*，支持热重载、在线改 Props 与盒模型调样式）')
  .argument('[dir]', 'Zhin 项目或插件目录', '.')
  .option('-p, --port <port>', '预览服务监听端口', '4176')
  .option('-H, --host <host>', '预览服务监听地址', '127.0.0.1')
  .option('--open', '启动后自动在浏览器打开预览页')
  .option('--export <file>', '仅导出单文件静态 HTML 预览快照并退出')
  .option('--json', '以 JSON 输出当前项目扫描与渲染结果并退出')
  .action(async (dir: string, options: PreviewCommandOptions) => {
    const projectRoot = resolve(dir);
    const customComponentProps = new Map<string, unknown>();
    const customPageData = new Map<string, Record<string, unknown>>();

    const initialSnapshot = await buildProjectPreviewSnapshot(projectRoot, customComponentProps, customPageData);

    if (options.json) {
      process.stdout.write(`${JSON.stringify(initialSnapshot, null, 2)}\n`);
      return;
    }

    if (options.export) {
      const targetFile = resolve(options.export);
      await mkdir(dirname(targetFile), { recursive: true });
      await writeFile(targetFile, renderPreviewWorkbenchHtml(initialSnapshot, false), 'utf8');
      console.log(chalk.green(`✓ 已导出组件与页面预览文件：${targetFile}`));
      return;
    }

    let latestSnapshot = initialSnapshot;
    const sseClients = new Set<ServerResponse>();

    const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', `http://${options.host}`);
      if (url.pathname === '/__events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        res.write('retry: 500\n\n');
        sseClients.add(res);
        req.on('close', () => sseClients.delete(res));
        return;
      }

      if (url.pathname === '/__api/render-component' && req.method === 'POST') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
            id: string;
            props?: unknown;
            reset?: boolean;
          };
          if (body.reset) {
            customComponentProps.delete(body.id);
          } else {
            customComponentProps.set(body.id, body.props);
          }
          latestSnapshot = await buildProjectPreviewSnapshot(projectRoot, customComponentProps, customPageData);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ snapshot: latestSnapshot }));
        } catch (err) {
          console.error('Failed to render component preview:', err);
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: 'Failed to render component.' }));
        }
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderPreviewWorkbenchHtml(latestSnapshot, true));
    });

    const watchers: FSWatcher[] = [];
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    const triggerReload = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        try {
          latestSnapshot = await buildProjectPreviewSnapshot(projectRoot, customComponentProps, customPageData);
          const payload = `data: ${JSON.stringify({ snapshot: latestSnapshot })}\n\n`;
          for (const client of sseClients) client.write(payload);
        } catch { /* ignore transient save errors */ }
      }, 120);
    };

    for (const sub of ['components', 'pages', 'plugins']) {
      const watchTarget = join(projectRoot, sub);
      if (existsSync(watchTarget)) {
        try {
          watchers.push(watch(watchTarget, { recursive: true }, triggerReload));
        } catch { /* ignore if recursive watch unsupported */ }
      }
    }

    const desiredPort = Number.parseInt(options.port, 10) || 4176;
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(desiredPort, options.host, () => resolveListen());
    });

    const addr = server.address();
    const actualPort = typeof addr === 'object' && addr ? addr.port : desiredPort;
    const previewUrl = `http://${options.host}:${actualPort}`;

    console.log(chalk.bold.cyan(`\n⚡ Zhin 组件与页面预览工作台已启动`));
    console.log(`  ${chalk.gray('项目目录:')} ${projectRoot}`);
    console.log(`  ${chalk.gray('发现能力:')} ${latestSnapshot.components.length} 个 IM 组件 (components/), ${latestSnapshot.pages.length} 个页面 (pages/)`);
    console.log(`  ${chalk.gray('预览地址:')} ${chalk.green.underline(previewUrl)}\n`);

    if (options.open) {
      const openMod = await import('open').catch(() => null);
      if (openMod?.default) await openMod.default(previewUrl).catch(() => undefined);
    }

    const cleanup = () => {
      for (const w of watchers) w.close();
      server.close();
    };
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
  });
