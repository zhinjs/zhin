import React from 'react';
import { createRoot } from 'react-dom/client';
import { AdapterConsolePage } from '../../packages/console/client/client/adapter-console/AdapterConsolePage.js';
import type { AdapterConsoleStatus, AdapterConsoleLoginTask } from '../../packages/console/client/client/adapter-console/types.js';
import Sandbox from '../../plugins/adapters/sandbox/pages/index/SandboxChat.js';
import CommentReview from '../../plugins/adapters/bilibili/pages/index/CommentReview.js';
import type { ReviewEndpoint } from '../../plugins/adapters/bilibili/pages/index/rpc.js';
import { createDefaultPlaygroundState } from '../../plugins/adapters/sandbox/pages/index/playgroundState.js';

/** In-memory transport fixture. This gallery never forwards requests to a Host or a platform. */
const adapterKey = location.pathname.slice(1) || 'icqq';
const names: Record<string, string> = { icqq: 'ICQQ', telegram: 'Telegram', discord: 'Discord' };
const ids = adapterKey === 'icqq' ? ['1000123456', '1000654321'] : ['community-bot', 'support-bot'];
const now = Date.now();
let status: AdapterConsoleStatus = {
  adapterKey, displayName: names[adapterKey] ?? adapterKey, page: location.pathname,
  canAdd: true, canRemove: true, configStore: true, docsUrl: 'https://zhin.dev',
  fields: [
    { key: 'token', type: 'string', required: true, env: true, secret: true, description: '平台访问凭据，仅在需要更新时填写', descriptionI18n: { en: 'Platform credential. Only enter it when updating.' } },
    { key: 'useProxy', type: 'boolean', required: false, env: false, secret: false, description: '启用代理（可选）' },
    { key: 'server', type: 'string', required: false, env: false, secret: false, description: '连接地址（可选）' },
  ],
  configured: ids.map((id, index) => ({ id, instanceId: `preview-${index}`, values: { token: '••••••', server: 'wss://gateway.example.test' } })),
  running: ids.map(id => ({ id })),
  actions: [{ name: 'inspect', label: '检查平台服务', description: '检测平台接口是否可访问，不会发送消息。', fields: [], options: [] }],
  extra: { '协议': adapterKey === 'icqq' ? 'QQ' : 'WebSocket', '消息能力': '文本、图片、文件', '自动重连': true },
  runtime: {
    adapterId: 'preview-adapter', generation: 1, revision: 1, needsMigration: false,
    canManage: true, canMigrate: true, canUpdate: true, canReplace: true, mutableFields: ['token', 'server'], identityFields: ['id'],
    endpoints: ids.map((id, index) => ({ instanceId: `preview-${index}`, canonicalId: `canonical-${index}`, endpointId: id,
      revision: 1, desiredEnabled: true, epoch: 1, incarnationId: `incarnation-${index}`, started: true, admitted: index === 0 })),
  },
};
const qrImage = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><rect width="180" height="180" fill="white"/><path d="M18 18h42v42H18zm102 0h42v42h-42zM18 120h42v42H18zM82 24h12v48H82zm-10 60h36v12H72zm48-12h12v24h-12zM78 114h24v48H78zm36 0h48v12h-48zm18 24h30v24h-30z" fill="#242427"/><text x="90" y="104" text-anchor="middle" fill="#686870" font-size="10">PREVIEW ONLY</text></svg>')}`;
let loginTasks: AdapterConsoleLoginTask[] = adapterKey === 'icqq' ? [{
  id: 'preview-login', adapter: adapterKey, endpointKey: ids[1] ?? 'support-bot', type: 'qrcode', createdAt: now, expiresAt: now + 300_000,
  payload: { image: qrImage, message: '请使用手机 QQ 扫描二维码，并在手机上确认登录。\n登录完成后，点击「已扫码，继续」。' },
  endpointIdentity: { canonicalId: 'canonical-1', instanceId: 'preview-1', epoch: 1, incarnationId: 'incarnation-1' },
}] : [];
let review: ReviewEndpoint = {
  id: 'bilibili-community', sendMode: 'review', persistent: true, circuit: null,
  login: { state: 'ok', source: 'qr', mid: '10001', uname: 'Zhin 社区' }, qr: { state: 'idle' },
  videos: [{ ref: 'BV1Preview', url: 'https://www.bilibili.com' }], pendingCount: 2,
  drafts: [
    { id: 'draft-1', video: 'Zhin 入门教程', url: 'https://www.bilibili.com', createdAt: now - 180_000, status: 'pending', interrupted: false,
      author: '新用户', original: '可以同时接入 QQ 和 Telegram 吗？配置会不会很复杂？',
      message: '可以的。每个平台使用独立的适配器，你可以在同一个项目里同时启用 QQ 和 Telegram。先跑通一个平台，再添加第二个，会更容易检查配置。' },
    { id: 'draft-2', video: 'Zhin 插件开发', url: 'https://www.bilibili.com', createdAt: now - 900_000, status: 'pending', interrupted: false,
      author: '社区开发者', original: '热重载后机器人会丢失会话记录吗？', message: '会话历史和插件运行状态是分开管理的。配置了持久化存储时，正常的插件热重载不会删除历史记录。' },
  ],
};
const json = (data: unknown) => Response.json({ success: true, data });
const sessionState = createDefaultPlaygroundState();
const traces: Record<string, unknown[]> = {};
localStorage.setItem('zhin_api_base', location.origin);

window.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.origin);
  if (url.hostname === 'face.viki.moe') return Response.json([]);
  if (url.pathname === '/console/api/pages') return Response.json({ pages: [{ owner: 'preview-owner', localName: 'index', source: `plugins/adapters/${adapterKey}/pages/index/index.ts`, route: location.pathname }] });
  if (url.pathname === '/api/agent/traces') {
    const sessionKey = url.searchParams.get('sessionKey') ?? '';
    return json({ sessionKey, events: traces[sessionKey] ?? [], latestSequence: traces[sessionKey]?.length ?? 0, activeTurnIds: [] });
  }
  if (url.pathname === '/api/conversations/workspaces') return new Response('', { status: 404 });
  if (url.pathname === '/api/interactions/pending') return json({ generation: 1, pending: [] });
  if (url.pathname === '/api/conversations/results') return json({ sessionKey: url.searchParams.get('sessionKey'), results: [], hasMore: false, nextCursor: null });
  if (url.pathname === '/api/console/request') {
    const body = JSON.parse(String(init?.body ?? '{}'));
    const method = String(body.type).replace(/^plugin\.preview-owner\./, '');
    if (method === 'status') return json(adapterKey === 'bilibili' ? { endpoints: [review], updatedAt: Date.now() } : status);
    const runtime = status.runtime;
    if (!runtime) throw new Error('Preview account directory is missing');
    if (method === 'endpoint.list') return json({ endpoints: runtime.endpoints.map((endpoint, index) => ({
      name: endpoint.endpointId, adapter: adapterKey, endpoint: { id: endpoint.canonicalId, adapter: adapterKey },
      connected: endpoint.desiredEnabled && !loginTasks.some(task => task.endpointKey === endpoint.endpointId),
      status: endpoint.desiredEnabled && index === 0 ? 'online' : 'offline', transportState: endpoint.desiredEnabled ? 'open' : 'stopped',
      pendingLogin: loginTasks.some(task => task.endpointKey === endpoint.endpointId),
    })) });
    if (method === 'login.list') return json({ tasks: loginTasks });
    if (method === 'endpoint.test') return json({ connected: true, reachable: true, latencyMs: 24, message: '连接正常' });
    if (method === 'login.submit' || method === 'login.cancel') { loginTasks = []; return json({}); }
    if (method === 'inspect') return json({ message: '平台服务可访问，连接正常。', tone: 'ok', details: { '延迟': '24 ms' } });
    if (method.startsWith('endpoint-')) {
      const data = body.data;
      const action = method.slice(9);
      if (data.expectedRevision !== runtime.revision) return Response.json({ success: false, error: '账号清单已变化', code: 'conflict' }, { status: 409 });
      let endpoints = [...runtime.endpoints];
      if (action === 'add') {
        const id = `preview-${endpoints.length}-${Date.now()}`;
        endpoints.push({ instanceId: id, canonicalId: id, incarnationId: id, endpointId: data.id, desiredEnabled: false, started: false, admitted: false, revision: 1, epoch: 1 });
        status = { ...status, configured: [...status.configured, { id: data.id, instanceId: id, values: { ...data.values, token: '••••••' } }] };
      } else if (action === 'remove') {
        endpoints = endpoints.filter(endpoint => endpoint.instanceId !== data.instanceId);
      } else if (action === 'start' || action === 'stop') {
        endpoints = endpoints.map(endpoint => endpoint.instanceId === data.instanceId ? { ...endpoint, desiredEnabled: action === 'start', started: action === 'start' } : endpoint);
      } else {
        status = { ...status, configured: status.configured.map(entry => entry.instanceId === data.instanceId ? { ...entry, id: data.id ?? entry.id, values: { ...entry.values, ...data.values, token: '••••••' } } : entry) };
        endpoints = endpoints.map(endpoint => endpoint.instanceId === data.instanceId ? { ...endpoint, endpointId: data.id ?? endpoint.endpointId } : endpoint);
      }
      status = { ...status, runtime: { ...runtime, revision: (runtime.revision ?? 0) + 1, endpoints } };
      return json({ saved: true, restartRequired: false, runtime: status.runtime, execution: { status: 'applied' } });
    }
    if (method === 'edit') review = { ...review, drafts: review.drafts.map(draft => draft.id === body.data.id ? { ...draft, message: body.data.message } : draft) };
    if (method === 'drop' || method === 'send') review = { ...review, drafts: review.drafts.filter(draft => draft.id !== body.data.id), pendingCount: Math.max(0, review.pendingCount - 1) };
    return json(method === 'send' ? { url: 'https://www.bilibili.com' } : {});
  }
  throw new Error(`Unimplemented preview request: ${url.pathname}`);
};

class PreviewSocket {
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    setTimeout(() => {
      this.onopen?.();
      this.emit({ type: 'ready', id: 'preview-owner', endpoint: 'sandbox-preview', protocol: 'scoped-conversations-v1', connectionId: 'preview-connection', canExecute: true, locale: 'zh-CN', timestamp: Date.now() });
    }, 30);
  }
  emit(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
  send(raw: string) {
    const frame = JSON.parse(raw);
    if (frame.op === 'subscribe') return;
    const conversation = { type: frame.type, id: frame.id };
    const sessionKey = `sandbox:sandbox-preview:${frame.type}:${frame.id}`;
    const recordedAt = Date.now();
    traces[sessionKey] = ['turn_start', 'tool_call', 'tool_result', 'turn_end'].map((type, index) => ({
      sequence: index + 1, recordedAt: recordedAt + index, sessionKey, turnId: 'preview-turn', type,
      data: type === 'tool_call' ? { name: 'inspect_environment', input: {} } : type === 'tool_result' ? { name: 'inspect_environment', result: 'Preview environment' } : {},
    }));
    this.emit({ ...frame, conversation, type: frame.type, direction: 'inbound', senderId: 'preview-owner' });
    setTimeout(() => this.emit({ type: frame.type, conversation, messageId: `reply-${Date.now()}`, timestamp: Date.now(), content: [{ type: 'text', data: { text: '这是一条界面预览回复。\n\n**本地演示**支持消息输入、会话切换、Markdown 预览和运行检查器；没有调用真实模型或平台。' } }] }), 150);
  }
  close() { this.readyState = 3; this.onclose?.(); }
}
Object.defineProperty(window, 'WebSocket', { value: PreviewSocket });
// Keep the fixture sessions in the same format consumed by the production browser fallback.
localStorage.setItem('zhin.sandbox.agent-playground.v1', JSON.stringify(sessionState));
document.querySelectorAll<HTMLAnchorElement>('.preview-bar a').forEach(link => { if (link.pathname === location.pathname) link.setAttribute('aria-current', 'page'); });
document.getElementById('theme')?.addEventListener('click', event => {
  const dark = document.documentElement.classList.toggle('dark');
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const button = event.currentTarget as HTMLButtonElement;
  button.setAttribute('aria-pressed', String(dark)); button.textContent = dark ? '浅色模式' : '深色模式';
});
const root = document.getElementById('root');
if (!root) throw new Error('Preview mount point is missing');
createRoot(root).render(adapterKey === 'sandbox' ? <div className="preview-sandbox"><Sandbox /></div> : adapterKey === 'bilibili' ? <CommentReview /> : <AdapterConsolePage adapterKey={adapterKey} />);
