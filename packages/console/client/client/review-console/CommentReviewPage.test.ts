import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { allNodes, createHookEnv, isComponent, textOf } from '../../tests/hook-harness.js';

const file = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
const zh = (key: string, ...values: (string | number)[]) => key.replace(/\{(\d+)\}/g, (_m, index: string) => String(values[Number(index)]));

type Draft = { id: string; url: string; message: string; status: 'pending' | 'sending'; interrupted: boolean; createdAt: number; author?: string; original?: string; video: string };
const draft = (extra: Partial<Draft> = {}): Draft => ({ id: 'd1', url: 'https://x.test/c', message: '你好', status: 'pending', interrupted: false, createdAt: Date.now(), author: '小明', original: '原评论内容', video: 'av1', ...extra });
const endpoint = (extra: Record<string, unknown> = {}) => ({
  id: 'main', sendMode: 'review', persistent: true, circuit: null, login: { state: 'ok', mid: '7', uname: 'bot' },
  pendingCount: 1, drafts: [draft()], qr: { state: 'idle' }, ...extra,
});

let extrasContext: { act(method: string): Promise<void>; pending: string | undefined; noun: string } | undefined;
const spec = {
  adapter: 'demo', platform: { zh: '示例站', en: 'Demo' }, mark: 'D', resource: { zh: '视频', en: 'videos' },
  account: (e: { login: { mid?: string; uname?: string } }) => ({ id: e.login.mid, name: e.login.uname }),
  draftResource: (d: Draft) => d.video,
  isLoginPending: (e: { qr: { state: string } }) => e.qr.state === 'waiting',
  renderLoginExtras: (_e: unknown, context: typeof extrasContext) => { extrasContext = context; return { type: 'section', props: { 'data-slot': 'login-extras', children: 'QR 扫码区' } }; },
};

function session(overrides: Record<string, unknown> = {}) {
  return { spec, t: zh, locale: 'zh-CN', call: vi.fn(async () => ({ url: 'https://x.test/posted' })), refresh: vi.fn(), notify: vi.fn(), ...overrides };
}

function mountCard(props: { draft?: Draft; endpoint?: Record<string, unknown>; session?: ReturnType<typeof session> } = {}) {
  const env = createHookEnv();
  const mod = env.load(file('./CommentReviewPage.tsx'));
  const s = props.session ?? session();
  env.mount(() => (mod.DraftCard as (p: unknown) => unknown)({ draft: props.draft ?? draft(), endpoint: props.endpoint ?? endpoint(), session: s }));
  const nodes = () => allNodes(env.tree());
  const button = (label: string) => {
    const node = nodes().find(n => isComponent(n, 'Button') && textOf(n.props?.children) === label);
    if (!node) throw new Error(`missing button ${label}: ${textOf(env.tree())}`);
    return node.props as { onClick: () => Promise<void> | void; disabled?: boolean; busy?: boolean };
  };
  const confirm = () => nodes().find(n => isComponent(n, 'ConfirmButton'))!.props as { confirmLabel: string; message: string; onConfirm: () => Promise<void>; children: string; disabled?: boolean };
  const textarea = () => nodes().find(n => n.type === 'textarea')!.props as { value: string; onChange(e: { target: { value: string } }): void };
  return { env, s, nodes, button, confirm, textarea, text: () => textOf(env.tree()) };
}

describe('DraftCard', () => {
  it('shows the original comment, proposed reply and the resource label', () => {
    const view = mountCard();
    expect(view.text()).toContain('av1');
    expect(view.text()).toContain('原评论 · 小明');
    expect(view.text()).toContain('原评论内容');
    expect(view.text()).toContain('你好');
  });

  it('edits then saves through the edit RPC, notifies and refreshes', async () => {
    const view = mountCard();
    await (view.button('修改').onClick as () => void)();
    view.env.rerender();
    view.textarea().onChange({ target: { value: '新的回复' } });
    view.env.rerender();
    expect(view.textarea().value).toBe('新的回复');
    await view.button('保存').onClick(); await view.env.settle();
    expect(view.s.call).toHaveBeenCalledWith('edit', { id: 'd1', message: '新的回复', locale: 'zh-CN' });
    expect(view.s.notify).toHaveBeenCalledWith({ tone: 'success', message: '已保存修改' });
    expect(view.s.refresh).toHaveBeenCalled();
  });

  it('sends the edited text first, then reports the posted link', async () => {
    const view = mountCard();
    await (view.button('修改').onClick as () => void)();
    view.env.rerender();
    view.textarea().onChange({ target: { value: '改过的' } });
    view.env.rerender();
    await view.button('发送').onClick(); await view.env.settle();
    expect(view.s.call.mock.calls.map(c => c[0])).toEqual(['edit', 'send']);
    expect(view.s.notify).toHaveBeenCalledWith({ tone: 'success', message: '已发出', link: 'https://x.test/posted' });
  });

  it('discards through an inline ConfirmButton labelled 丢弃草稿, never window.confirm', async () => {
    const windowConfirm = vi.fn(() => true);
    vi.stubGlobal('window', { confirm: windowConfirm });
    const view = mountCard();
    const confirm = view.confirm();
    expect(confirm.children).toBe('丢弃草稿'); expect(confirm.confirmLabel).toBe('丢弃草稿');
    expect(view.s.call).not.toHaveBeenCalled();
    await confirm.onConfirm(); await view.env.settle();
    expect(view.s.call).toHaveBeenCalledWith('drop', { id: 'd1', locale: 'zh-CN' });
    expect(view.s.notify).toHaveBeenCalledWith({ tone: 'success', message: '已丢弃' });
    expect(windowConfirm).not.toHaveBeenCalled();
  });

  it('reports a failed send as a danger notice and still refreshes', async () => {
    const view = mountCard({ session: session({ call: vi.fn(async () => { throw new Error('被风控'); }) }) });
    await view.button('发送').onClick(); await view.env.settle();
    expect(view.s.notify).toHaveBeenCalledWith({ tone: 'danger', message: '被风控' });
    expect(view.s.refresh).toHaveBeenCalled();
  });

  it('states the overflow in words and blocks sending when over the limit', async () => {
    const view = mountCard();
    await (view.button('修改').onClick as () => void)();
    view.env.rerender();
    view.textarea().onChange({ target: { value: 'a'.repeat(1003) } });
    view.env.rerender();
    const field = view.nodes().find(n => isComponent(n, 'Field'))!.props as { error?: string; hint?: string };
    expect(field.error).toBe('超出 3 字'); expect(field.hint).toBe('1003 / 1000 字');
    expect(view.button('发送').disabled).toBe(true); expect(view.button('保存').disabled).toBe(true);
    expect(view.nodes().some(n => n.type === 'textarea' && 'autoFocus' in (n.props ?? {}))).toBe(false);
  });

  it('keeps the unconfirmed-result warning for interrupted sends', () => {
    const view = mountCard({ draft: draft({ interrupted: true }) });
    const notice = view.nodes().find(n => isComponent(n, 'Notice'))!.props as { tone: string; title: string; children: string };
    expect(notice.tone).toBe('warning'); expect(notice.title).toBe('结果未确认');
    expect(textOf(notice.children)).toContain('示例站');
  });

  it('cannot send while outbound is off or the login is not ok', () => {
    expect(mountCard({ endpoint: endpoint({ sendMode: 'off' }) }).button('发送').disabled).toBe(true);
    expect(mountCard({ endpoint: endpoint({ login: { state: 'expired' } }) }).button('发送').disabled).toBe(true);
    expect(mountCard().button('发送').disabled).toBe(false);
  });
});

describe('EndpointSection', () => {
  it('renders the login extras slot with a working act()', async () => {
    extrasContext = undefined;
    const env = createHookEnv();
    const mod = env.load(file('./CommentReviewPage.tsx'));
    const s = session();
    env.mount(() => (mod.EndpointSection as (p: unknown) => unknown)({ endpoint: endpoint(), showTitle: false, session: s }));
    expect(textOf(env.tree())).toContain('QR 扫码区');
    expect(allNodes(env.tree()).some(n => n.props?.['data-slot'] === 'login-extras')).toBe(true);
    expect(textOf(env.tree())).toContain('bot · uid 7');
    expect(allNodes(env.tree()).filter(n => isComponent(n, 'DraftCard'))).toHaveLength(1);
    expect(extrasContext!.noun).toBe('视频');
    await extrasContext!.act('login'); await env.settle();
    expect(s.call).toHaveBeenCalledWith('login', { endpoint: 'main', locale: 'zh-CN' });
    expect(s.refresh).toHaveBeenCalled();
    s.call.mockRejectedValueOnce(new Error('失败了'));
    await extrasContext!.act('logout'); await env.settle();
    expect(s.notify).toHaveBeenCalledWith({ tone: 'danger', message: '失败了' });
  });

  it('shows a persistent circuit-breaker alert', () => {
    const env = createHookEnv();
    const mod = env.load(file('./CommentReviewPage.tsx'));
    env.mount(() => (mod.EndpointSection as (p: unknown) => unknown)({ endpoint: endpoint({ circuit: { code: -412 } }), showTitle: true, session: session() }));
    expect(textOf(env.tree())).toContain('-412'); expect(textOf(env.tree())).toContain('账号 main');
  });
});

describe('CommentReviewSession', () => {
  function host(initial: unknown) {
    vi.useFakeTimers();
    const store = { status: initial as unknown, fail: false, statusCalls: 0, calls: [] as string[] };
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
    vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
    vi.stubGlobal('location', { pathname: '/demo', origin: 'https://host.test' });
    vi.stubGlobal('navigator', { languages: ['zh-CN'] });
    vi.stubGlobal('window', { location, dispatchEvent: vi.fn() });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/console/api/pages')) return Response.json({ pages: [{ owner: 'plugin-a', localName: 'index', source: 'adapters/demo/pages/index/index.tsx', route: '/demo' }] });
      const body = JSON.parse(String(init?.body ?? '{}')) as { type: string };
      store.calls.push(body.type);
      if (body.type === 'plugin.plugin-a.status') {
        store.statusCalls++;
        if (store.fail) return new Response(JSON.stringify({ success: false, code: 'unavailable', error: '主机无响应' }), { status: 503 });
        return Response.json({ success: true, data: store.status });
      }
      return Response.json({ success: true, data: {} });
    }));
    const env = createHookEnv();
    const mod = env.load(file('./CommentReviewPage.tsx'));
    env.mount(() => (mod.CommentReviewSession as (p: unknown) => unknown)({ spec }));
    const nodes = () => allNodes(env.tree());
    return { env, store, nodes, text: () => textOf(env.tree()), refreshButton: () => nodes().find(n => isComponent(n, 'Button'))!.props as { onClick: () => Promise<void>; busy?: boolean } };
  }
  const status = (endpoints: unknown[]) => ({ endpoints, updatedAt: Date.now() });

  it('shows loading, then one section per endpoint for the resolved plugin', async () => {
    const view = host(status([endpoint()]));
    expect(view.nodes().some(n => isComponent(n, 'LoadingState'))).toBe(true);
    await view.env.settle();
    expect(view.store.calls).toContain('plugin.plugin-a.status');
    expect(view.nodes().filter(n => isComponent(n, 'EndpointSection'))).toHaveLength(1);
    expect(view.text()).toContain('示例站评论审批');
    view.env.unmount();
  });

  it('shows an empty state when the adapter has no endpoints', async () => {
    const view = host(status([]));
    await view.env.settle();
    expect(view.nodes().some(n => isComponent(n, 'EmptyState'))).toBe(true);
    expect(view.nodes().some(n => isComponent(n, 'EndpointSection'))).toBe(false);
    view.env.unmount();
  });

  it('shows an error state with retry when the first load fails', async () => {
    const view = host(status([endpoint()]));
    view.store.fail = true;
    await view.env.settle();
    const state = view.nodes().find(n => isComponent(n, 'ErrorState'))!.props as { message: string; onRetry: () => unknown };
    expect(state.message).toBe('主机无响应'); expect(typeof state.onRetry).toBe('function');
    view.env.unmount();
  });

  it('keeps the data but flags it as stale when a refresh fails', async () => {
    const view = host(status([endpoint()]));
    await view.env.settle();
    view.store.fail = true;
    await view.refreshButton().onClick(); await view.env.settle();
    const stale = view.nodes().find(n => isComponent(n, 'StaleNotice'))!.props as { error: string; lastSuccessAt: number };
    expect(stale.error).toBe('主机无响应'); expect(stale.lastSuccessAt).toBeTypeOf('number');
    expect(view.nodes().some(n => isComponent(n, 'EndpointSection'))).toBe(true);
    view.env.unmount();
  });

  it('polls every 10s normally and every 2s while a login is pending', async () => {
    const view = host(status([endpoint()]));
    await view.env.settle();
    const idle = view.store.statusCalls;
    await vi.advanceTimersByTimeAsync(2000); await view.env.settle();
    expect(view.store.statusCalls).toBe(idle);
    await vi.advanceTimersByTimeAsync(8000); await view.env.settle();
    expect(view.store.statusCalls).toBe(idle + 1);
    view.env.unmount();

    const waiting = host(status([endpoint({ qr: { state: 'waiting', image: 'data:x' } })]));
    await waiting.env.settle();
    const start = waiting.store.statusCalls;
    await vi.advanceTimersByTimeAsync(2000); await waiting.env.settle();
    expect(waiting.store.statusCalls).toBeGreaterThan(start);
    waiting.env.unmount();
  });
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); extrasContext = undefined; });
