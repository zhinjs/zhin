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

export function inferPageCategory(page: ConsoleIndexPage): string {
  if (page.group && page.group.trim()) return page.group.trim();
  const owner = page.owner ?? '';
  if (owner.includes('adapter')) return 'adapter';
  if (owner === 'root' || !owner) return 'core';
  return 'plugin';
}

export function standaloneTokenBootstrapScript(probeAuth = true): string {
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

export function sandboxFallbackScript(): string {
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

export function pageModuleScript(moduleUrl: string, page: PageShellDescriptor): string {
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

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
