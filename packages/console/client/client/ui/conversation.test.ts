import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { allNodes, createHookEnv, isComponent, textOf } from '../../tests/hook-harness.js';

const file = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

function stubHost(handler: (type: string, data: Record<string, unknown>) => { code?: number; data?: unknown; error?: string }) {
  const calls: string[] = [];
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
  vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
  vi.stubGlobal('location', { pathname: '/p', origin: 'https://host.test' });
  vi.stubGlobal('window', { location, dispatchEvent: vi.fn() });
  vi.stubGlobal('document', { documentElement: { lang: 'zh-CN' } });
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { type: string } & Record<string, unknown>;
    calls.push(body.type);
    const { code = 200, data, error } = handler(body.type, body);
    return new Response(JSON.stringify(code === 200 ? { success: true, data } : { success: false, code: 'forbidden', error }), { status: code });
  }));
  return calls;
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const BOT = 'root/sandbox\u0000zhin.adapter\u0000sandbox~sandbox-bot';
const endpoints = {
  endpoints: [{ endpoint: { adapter: 'sandbox', id: BOT }, name: 'sandbox-bot', adapter: 'sandbox', connected: true, status: 'online' }],
};
const messages = {
  messages: [
    {
      adapter: 'sandbox', endpointKey: 'sandbox-bot', timestamp: 300, direction: 'inbound',
      sender: { id: 'u-1', name: 'Alice' }, channel: { id: 'g-1', type: 'group', name: '测试群' },
      conversation: { endpoint: { adapter: 'sandbox', id: BOT }, kind: 'group', id: 'g-1' },
    },
    {
      // Older row without an observation: rebuilt from the account and channel columns.
      adapter: 'sandbox', endpointKey: 'sandbox-bot', timestamp: 200,
      sender: { id: 'sandbox-user', name: '小明' }, channel: { id: 'sandbox-user', type: 'private' },
    },
  ],
};
const GROUP_KEY = JSON.stringify(['conversation-v1', 'sandbox', BOT, 'group', 'g-1', null, null, null]);
const PRIVATE_KEY = JSON.stringify(['conversation-v1', 'sandbox', BOT, 'private', 'sandbox-user', null, null, null]);

describe('conversation directory (#1250)', () => {
  it('parses conversation-v1 keys, DeliveryTargets and their JSON; rejects anything else', () => {
    const env = createHookEnv();
    const { parseConversationAddress, serializeConversationAddress } = env.load(file('./conversation-directory.ts'));
    const group = parseConversationAddress(GROUP_KEY);
    expect(group).toEqual({ endpoint: { adapter: 'sandbox', id: BOT }, kind: 'group', id: 'g-1' });
    expect(parseConversationAddress(JSON.parse(GROUP_KEY))).toEqual(group);
    expect(parseConversationAddress(serializeConversationAddress(group))).toEqual(group);
    expect(parseConversationAddress({ endpoint: { adapter: 'a', id: 'b' }, kind: 'channel', id: 'c', parent: { kind: 'group', id: 'p' }, threadId: 't' }))
      .toEqual({ endpoint: { adapter: 'a', id: 'b' }, kind: 'channel', id: 'c', parent: { kind: 'group', id: 'p' }, threadId: 't' });
    for (const bad of ['global', 'g2', '["other",1]', '{oops', { kind: 'group', id: 'x' }, null, 42]) {
      expect(parseConversationAddress(bad)).toBeUndefined();
    }
  });

  it('names conversations and users from accounts and recent inbox messages', () => {
    const env = createHookEnv();
    const { buildConversationDirectory, formatConversationLabel } = env.load(file('./conversation-directory.ts'));
    const directory = buildConversationDirectory({ endpoints, messages });
    expect(directory.accounts).toEqual([{ adapter: 'sandbox', endpointId: BOT, name: 'sandbox-bot', online: true }]);
    expect(directory.conversations.map((entry: { address: { id: string } }) => entry.address.id)).toEqual(['g-1', 'sandbox-user']);
    expect(formatConversationLabel(directory.describe(GROUP_KEY), 'zh-CN')).toBe('群聊 · 测试群（g-1） · sandbox-bot');
    expect(formatConversationLabel(directory.describe(PRIVATE_KEY), 'en')).toBe('Private · 小明 (sandbox-user) · sandbox-bot');
    expect(directory.userName('u-1', { adapter: 'sandbox', id: BOT })).toBe('Alice');
    // Without any Host data the raw key still becomes readable, with the account parsed from the id.
    const empty = buildConversationDirectory({});
    expect(formatConversationLabel(empty.describe(PRIVATE_KEY), 'zh-CN')).toBe('私聊 · sandbox-user · sandbox-bot');
    expect(empty.describe('global')).toBeUndefined();
  });

  it('filters picker options by name, id, account and kind', () => {
    const env = createHookEnv();
    const { buildConversationDirectory } = env.load(file('./conversation-directory.ts'));
    const { filterConversationOptions } = env.load(file('./conversation-picker.tsx'));
    const directory = buildConversationDirectory({ endpoints, messages });
    const labels = (query: string, kinds?: string[]) =>
      filterConversationOptions(directory, query, { ...(kinds ? { kinds } : {}) }).map((option: { label: string }) => option.label);
    expect(labels('')).toHaveLength(2);
    expect(labels('测试')).toEqual(['群聊 · 测试群（g-1） · sandbox-bot']);
    expect(labels('SANDBOX-USER')).toHaveLength(1);
    expect(labels('', ['group'])).toHaveLength(1);
    expect(labels('私聊')).toHaveLength(1);
    expect(labels('nothing-like-this')).toEqual([]);
  });
});

describe('ConversationPicker / ConversationLabel (#1250)', () => {
  it('lists recent conversations from the existing RPCs and emits the chosen DeliveryTarget as JSON', async () => {
    const calls = stubHost((type) => type === 'endpoint.list' ? { data: endpoints } : { data: messages });
    const env = createHookEnv();
    const { ConversationPicker } = env.load(file('./conversation-picker.tsx'));
    const onChange = vi.fn();
    env.mount(() => ConversationPicker({ value: '', onChange }));
    await env.settle();
    expect(calls.sort()).toEqual(['endpoint.list', 'inbox.recent']);
    const options = allNodes(env.tree()).filter(node => node.type === 'button' && node.props?.['data-conversation-key']);
    expect(options.map(textOf)).toEqual(['群聊 · 测试群（g-1） · sandbox-bot', '私聊 · 小明（sandbox-user） · sandbox-bot']);
    (options[0]!.props!.onClick as () => void)();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(JSON.parse(onChange.mock.calls[0]![0] as string)).toEqual({ endpoint: { adapter: 'sandbox', id: BOT }, kind: 'group', id: 'g-1' });
    env.unmount();
  });

  it('keeps manual entry when the recent inbox is not readable, and builds the target from the chosen account', async () => {
    stubHost((type) => type === 'endpoint.list' ? { data: endpoints } : { code: 403, error: 'denied' });
    const env = createHookEnv();
    const { ConversationPicker } = env.load(file('./conversation-picker.tsx'));
    const onChange = vi.fn();
    env.mount(() => ConversationPicker({ value: '', onChange, kinds: ['group', 'private'] }));
    await env.settle();
    expect(textOf(env.tree())).toContain('无法读取最近会话');
    const toggle = allNodes(env.tree()).find(node => isComponent(node, 'Button') && textOf(node).includes('手动填写'))!;
    (toggle.props!.onClick as () => void)();
    env.rerender();
    const idInput = allNodes(env.tree()).find(node => isComponent(node, 'Input') && node.props?.['aria-label'] === '会话 ID')!;
    (idInput.props!.onChange as (event: { target: { value: string } }) => void)({ target: { value: '12345' } });
    env.rerender();
    const use = allNodes(env.tree()).find(node => isComponent(node, 'Button') && textOf(node) === '使用该会话')!;
    expect(use.props!.disabled).toBe(false);
    (use.props!.onClick as () => void)();
    expect(JSON.parse(onChange.mock.calls[0]![0] as string)).toEqual({ endpoint: { adapter: 'sandbox', id: BOT }, kind: 'group', id: '12345' });
    env.unmount();
  });

  it('without endpoint.view, allows typing the adapter, account ID and conversation, and names the missing permission', async () => {
    stubHost(() => ({ code: 403, error: 'denied' }));
    const env = createHookEnv();
    const { ConversationPicker, parseManualEndpointId } = env.load(file('./conversation-picker.tsx'));
    const onChange = vi.fn();
    env.mount(() => ConversationPicker({ value: '', onChange, kinds: ['group'] }));
    await env.settle();
    expect(textOf(env.tree())).toContain('endpoint.view');
    const toggle = allNodes(env.tree()).find(node => isComponent(node, 'Button') && textOf(node).includes('手动填写'))!;
    (toggle.props!.onClick as () => void)();
    env.rerender();
    expect(textOf(env.tree())).toContain('未列出机器人账号（读取账号列表需要「查看账号」权限 endpoint.view）');
    expect(allNodes(env.tree()).some(node => isComponent(node, 'Select') && node.props?.['aria-label'] === '机器人账号')).toBe(false);
    const type = (label: string, value: string) => {
      const input = allNodes(env.tree()).find(node => isComponent(node, 'Input') && node.props?.['aria-label'] === label)!;
      (input.props!.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
      env.rerender();
    };
    const use = () => allNodes(env.tree()).find(node => isComponent(node, 'Button') && textOf(node) === '使用该会话')!;
    type('会话 ID', '12345');
    expect(use().props!.disabled).toBe(true);
    type('适配器', 'sandbox');
    expect(use().props!.disabled).toBe(true);
    type('账号 ID', 'root/sandbox\\0zhin.adapter\\u0000sandbox~sandbox-bot');
    expect(use().props!.disabled).toBe(false);
    (use().props!.onClick as () => void)();
    expect(JSON.parse(onChange.mock.calls[0]![0] as string)).toEqual({ endpoint: { adapter: 'sandbox', id: BOT }, kind: 'group', id: '12345' });
    expect(parseManualEndpointId(` ${BOT} `)).toBe(BOT);
    env.unmount();
  });

  it('N labels without a Provider share one endpoint.list + inbox.recent pair (in-flight dedupe and TTL cache)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const calls = stubHost((type) => type === 'endpoint.list' ? { data: endpoints } : { data: messages });
    const env = createHookEnv();
    const { ConversationLabel } = env.load(file('./conversation-picker.tsx'));
    env.mount(() => [ConversationLabel({ value: GROUP_KEY }), ConversationLabel({ value: PRIVATE_KEY }), ConversationLabel({ value: GROUP_KEY })]);
    await env.settle();
    expect(calls.sort()).toEqual(['endpoint.list', 'inbox.recent']);
    const texts = (env.tree() as { props: { children: unknown } }[]).map(node => textOf(node.props.children));
    expect(texts[0]).toBe('群聊 · 测试群（g-1） · sandbox-bot');
    // A later mount inside the TTL reuses the loaded snapshot (hook slots appended after the labels).
    const { useConversationDirectory } = env.load(file('./conversation-directory.ts'));
    const labels = () => [ConversationLabel({ value: GROUP_KEY }), ConversationLabel({ value: PRIVATE_KEY }), ConversationLabel({ value: GROUP_KEY })];
    env.mount(() => [...labels(), useConversationDirectory()]);
    await env.settle();
    expect(calls).toHaveLength(2);
    // After the TTL a new mount reads again.
    vi.setSystemTime(Date.now() + 10_001);
    env.mount(() => [...labels(), useConversationDirectory(), useConversationDirectory()]);
    await env.settle();
    expect(calls).toHaveLength(4);
    env.unmount();
  });

  it('labels a stored key by display name and shows other values unchanged', async () => {
    stubHost((type) => type === 'endpoint.list' ? { data: endpoints } : { data: messages });
    const env = createHookEnv();
    const { ConversationLabel } = env.load(file('./conversation-picker.tsx'));
    env.mount(() => ConversationLabel({ value: GROUP_KEY }));
    await env.settle();
    expect(textOf((env.tree() as { props: { children: unknown } }).props.children)).toBe('群聊 · 测试群（g-1） · sandbox-bot');
    env.unmount();
    const plain = createHookEnv();
    const { ConversationLabel: Label } = plain.load(file('./conversation-picker.tsx'));
    plain.mount(() => Label({ value: 'global' }));
    expect(textOf(plain.tree())).toBe('global');
  });
});

describe('declarative page additions (#1250)', () => {
  const mountPage = async (spec: Record<string, unknown>, status: unknown) => {
    stubHost(() => ({ data: status }));
    const env = createHookEnv();
    const { DeclarativePageView } = env.load(file('./declarative-page.tsx'));
    env.mount(() => DeclarativePageView({ spec, pageProps: { pluginId: 'root/demo' } }));
    await env.settle();
    return env;
  };

  it('greys out a muted entry and shows its badge; $i18n picks the viewer locale', async () => {
    const env = await mountPage({
      pluginId: 'root/demo',
      title: 'Demo',
      pollMs: 0,
      stats: [{ key: 'uptime', label: '运行', value: { $i18n: 'uptimeI18n' } }],
      sections: [{
        id: 'config',
        entries: [{
          label: '定时 Cron',
          dataKey: 'cron',
          muted: { $map: { path: 'enabled', cases: { false: 'true' }, default: 'false' } },
          badge: { label: { $map: { path: 'enabled', cases: { false: '未启用' }, default: '' } } },
        }],
      }],
    }, { enabled: false, cron: '0 0 18 * * *', uptimeI18n: { 'zh-CN': '1天2小时', en: '1d 2h' } });
    const nodes = allNodes(env.tree());
    const value = nodes.find(node => typeof node.props?.className === 'string' && (node.props.className as string).includes('zk-entry-card__value'))!;
    expect(value.props!.className).toContain('zk-entry-card__value--muted');
    expect(textOf(value)).toContain('未启用');
    expect(textOf(env.tree())).toContain('1天2小时');
    env.unmount();
  });

  it('renders date / time pickers and a conversation picker for action fields', async () => {
    const env = await mountPage({
      pluginId: 'root/demo',
      title: 'Demo',
      pollMs: 0,
      actions: [{
        name: 'create',
        label: '新建',
        fields: [
          { key: 'date', label: '日期', type: 'date' },
          { key: 'time', label: '时间', type: 'time' },
          { key: 'to', label: '推送到', type: 'conversation', conversationKinds: ['group'] },
        ],
      }],
    }, { ok: true });
    const inputs = allNodes(env.tree()).filter(node => node.type === 'input').map(node => node.props?.type);
    expect(inputs).toEqual(expect.arrayContaining(['date', 'time']));
    const fields = allNodes(env.tree()).filter(node => isComponent(node, 'Field'));
    const picker = fields.map(field => (field.props!.children as (control: unknown) => unknown))
      .filter(child => typeof child === 'function')
      .map(render => render({}) as { type?: { name?: string }; props?: Record<string, unknown> })
      .find(node => node?.type?.name === 'ConversationPicker');
    expect(picker?.props?.kinds).toEqual(['group']);
    env.unmount();
  });

  it('shows an action result inline under its form instead of a page-top banner', async () => {
    const env = await mountPage({
      pluginId: 'root/demo',
      title: 'Demo',
      pollMs: 0,
      actions: [{
        name: 'check-text',
        label: '检测文本',
        fields: [{ key: 'text', label: '测试文本', required: true }],
        result: {
          title: { $i18n: 'decisionI18n' },
          tone: { $map: { path: 'decision', cases: { block: 'danger' }, default: 'neutral' } },
          entries: [{ label: { zh: '命中词', en: 'Matched' }, value: { $path: 'hitsText' } }],
        },
      }],
    }, { decision: 'block', decisionI18n: { 'zh-CN': '拦截', en: 'Blocked' }, hitsText: '违禁词', message: 'Moderation decision: block' });
    const input = allNodes(env.tree()).find(node => node.type === 'input')!;
    (input.props!.onChange as (event: { target: { value: string } }) => void)({ target: { value: '含违禁词' } });
    env.rerender();
    const run = allNodes(env.tree()).find(node => isComponent(node, 'Button') && textOf(node) === '检测文本')!;
    await (run.props!.onClick as () => Promise<void>)();
    await env.settle();
    const inline = allNodes(env.tree()).find(node => isComponent(node, 'ActionInlineResult'))!;
    expect(inline.props).toMatchObject({ name: 'check-text', result: expect.objectContaining({ hitsText: '违禁词' }) });
    expect(allNodes(env.tree()).some(node => isComponent(node, 'Notice') && textOf(node).includes('Moderation decision'))).toBe(false);
    // The inline block itself: localized verdict and the listed details.
    const rendered = (inline.type as unknown as (props: unknown) => unknown)(inline.props);
    expect(textOf(rendered)).toContain('拦截');
    expect(textOf(rendered)).toContain('违禁词');
    env.unmount();
  });

  it('an inline result without its own tone uses the computed tone and shows the message it does not render', async () => {
    const env = await mountPage({
      pluginId: 'root/demo',
      title: 'Demo',
      pollMs: 0,
      actions: [{
        name: 'test-rule',
        label: '试运行',
        fields: [{ key: 'text', label: '文本' }],
        result: { title: '结果', entries: [{ label: '命中', value: { $path: 'hits' } }] },
      }, {
        name: 'echo',
        label: '回显',
        fields: [{ key: 'text', label: '文本' }],
        result: { title: { $path: 'message' }, tone: 'info' },
      }],
    }, { passed: false, hits: 'a, b', message: '规则未通过' });
    const runAction = async (label: string) => {
      const run = allNodes(env.tree()).find(node => isComponent(node, 'Button') && textOf(node) === label)!;
      await (run.props!.onClick as () => Promise<void>)();
      await env.settle();
    };
    await runAction('试运行');
    await runAction('回显');
    const inlines = allNodes(env.tree()).filter(node => isComponent(node, 'ActionInlineResult'));
    const [failed, echo] = inlines.map(node => ({ node, rendered: (node.type as unknown as (props: unknown) => unknown)(node.props) as { props: { className: string } } }));
    expect(failed!.node.props).toMatchObject({ name: 'test-rule', fallbackTone: 'danger', message: '规则未通过' });
    expect(failed!.rendered.props.className).toContain('zk-action-inline-result--danger');
    expect(textOf(failed!.rendered)).toContain('规则未通过');
    // The spec's own tone wins, and a message the spec already renders is not repeated.
    expect(echo!.rendered.props.className).toContain('zk-action-inline-result--info');
    expect(allNodes(echo!.rendered).filter(node => node.props?.['data-action-result-message'] !== undefined)).toHaveLength(0);
    expect(allNodes(env.tree()).some(node => isComponent(node, 'Notice') && textOf(node).includes('规则未通过'))).toBe(false);
    env.unmount();
  });

  it('loads accounts and recent conversations once per page and shares them with every conversation cell', async () => {
    const calls = stubHost((type) => type === 'endpoint.list' ? { data: endpoints }
      : type === 'inbox.recent' ? { data: messages }
      : { data: { rows: [{ id: 'a', to: GROUP_KEY }, { id: 'b', to: PRIVATE_KEY }] } });
    const env = createHookEnv();
    const { DeclarativePageView } = env.load(file('./declarative-page.tsx'));
    env.mount(() => DeclarativePageView({
      spec: { pluginId: 'root/demo', title: 'Demo', pollMs: 0, sections: [{ id: 'rows', items: 'rows', columns: [{ key: 'to', label: '会话', type: 'conversation' }] }] },
      pageProps: { pluginId: 'root/demo' },
    }));
    await env.settle();
    expect(calls.filter(type => type === 'endpoint.list')).toHaveLength(1);
    expect(calls.filter(type => type === 'inbox.recent')).toHaveLength(1);
    const root = env.tree() as { props: { value: { directory: { describe(value: unknown): { name?: string } } } } };
    expect(root.props.value.directory.describe(GROUP_KEY)?.name).toBe('测试群');
    const labels = allNodes(env.tree()).filter(node => isComponent(node, 'ConversationLabel')).map(node => node.props?.value);
    expect(labels).toEqual([GROUP_KEY, PRIVATE_KEY]);
    env.unmount();
  });
});
