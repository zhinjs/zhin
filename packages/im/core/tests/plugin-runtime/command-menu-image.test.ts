import { CommandIndex, commandFeatureId, defineCommand } from '@zhin.js/command';
import {
  childPluginId, createCapabilitySlot, featureId, htmlRendererToken, rootPluginId,
  type HtmlRendererHost, type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import type { ConversationRef } from '@zhin.js/im-contract';
import { getLogger } from '@zhin.js/logger';
import { jsx } from '@zhin.js/jsx';
import { projectOutboundPayload } from '../../src/plugin-runtime/im/outbound-projection.js';
import { commandMenuReply } from '../../src/plugin-runtime/im/command-menu-navigation.js';
import { commandMenuPresentationToken, type CommandMenuPresenter } from '../../src/plugin-runtime/im/command-menu-presentation.js';

function fixture(renderer?: HtmlRendererHost, html: 'image' | 'text' = 'image', media = ['base64']) {
  const root = rootPluginId();
  const child = childPluginId(root, 'music');
  const command = createCapabilitySlot({
    owner: root, feature: commandFeatureId, localName: 'ping', source: '/commands/ping/index.ts',
    definition: defineCommand({ description: '测试连通性 <安全> & "可读"', execute: () => 'pong' }),
  });
  const adapter = createCapabilitySlot({
    owner: root, feature: featureId('zhin.adapter'), localName: 'test', source: '/adapters/test/index.ts',
    definition: { segments: { html, outboundMedia: media } },
  });
  const resources = new Map();
  if (renderer) resources.set(htmlRendererToken.id, renderer);
  const snapshot: RuntimeSnapshot = {
    root, generation: 1,
    tree: new Map([
      [root, { id: root, instanceKey: 'root', packageName: 'test', packageRoot: '/project', children: [child] }],
      [child, { id: child, parent: root, instanceKey: 'music', packageName: 'music', packageRoot: '/music',
        children: [], metadata: { displayName: '<img src=x onerror=alert(1)>' } }],
    ]),
    config: new Map([[root, {}], [child, {}]]), resources: new Map([[root, resources]]),
    capabilities: new Map([[command.id, command], [adapter.id, adapter]]), projections: new Map(),
  };
  const index = new CommandIndex([command], snapshot, { keyword: '帮助' });
  const conversation: ConversationRef = { endpoint: { id: adapter.id, adapter: 'test' }, kind: 'private', id: 'user' };
  return { index, snapshot, conversation, resources };
}

function rendererFixture() {
  const render = vi.fn<HtmlRendererHost['render']>().mockResolvedValue({
    data: Buffer.from('png'), format: 'png', width: 1080, height: 500, mimeType: 'image/png',
  });
  return { render };
}

it('keeps the existing text menu when the renderer host is absent', async () => {
  const { index, snapshot, conversation } = fixture();
  const result = await index.dispatch('帮助', undefined, undefined, '/');
  expect(result.value).toBe('=== root 指令菜单 ===\n\n  /ping  - 测试连通性 <安全> & "可读"\n\n子插件：\n  music  (<img src=x onerror=alert(1)>)\n\n提示：使用「/帮助 <插件名>」查看子插件的指令');
  expect((await projectOutboundPayload(result.value, conversation, snapshot)).payload).toBe(result.value);
});

it('renders the real command menu through the outbound pipeline and escapes metadata', async () => {
  const renderer = rendererFixture();
  const { index, snapshot, conversation } = fixture(renderer);
  const result = await index.dispatch('帮助', undefined, undefined, '/');
  expect(result.value).toMatchObject({ type: 'html', data: {
    fileName: 'command-menu.png', width: 1080, html: expect.stringContaining('/ping'),
    text: expect.stringContaining('=== root 指令菜单 ==='),
  } });
  const projected = await projectOutboundPayload(result.value, conversation, snapshot);
  expect(projected.payload).toEqual([{ type: 'image', data: { media: {
    kind: 'base64', value: Buffer.from('png').toString('base64'), mime_type: 'image/png', file_name: 'command-menu.png',
  } } }]);
  const html = renderer.render.mock.calls[0]![0];
  expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  expect(html).toContain('测试连通性 &lt;安全&gt; &amp; &quot;可读&quot;');
  expect(html).not.toContain('<img');
  expect(renderer.render).toHaveBeenCalledOnce();
});

it.each(['failed', 'unavailable', 'text', 'url-only'] as const)('preserves exact text on %s fallback', async mode => {
  const renderer = rendererFixture();
  const { index, snapshot, conversation, resources } = fixture(renderer, mode === 'text' ? 'text' : 'image', mode === 'url-only' ? ['url'] : ['base64']);
  const result = await index.dispatch('帮助', undefined, undefined, '#');
  // Obtain the original text from the same menu without a renderer resource.
  resources.delete(htmlRendererToken.id);
  const plain = await index.dispatch('帮助', undefined, undefined, '#');
  if (mode !== 'unavailable') resources.set(htmlRendererToken.id, renderer);
  if (mode === 'failed') renderer.render.mockRejectedValueOnce(new Error('render failed'));
  const projected = await projectOutboundPayload(result.value, conversation, snapshot);
  expect(projected.payload).toEqual([{ type: 'text', data: { text: plain.value } }]);
  expect(projected.rendering.fallbacks).toContain(mode === 'failed' ? 'renderer_failed'
    : mode === 'unavailable' ? 'renderer_unavailable' : mode === 'text' ? 'html_text_policy' : 'media_unsupported');
  expect(renderer.render).toHaveBeenCalledTimes(mode === 'failed' ? 1 : 0);
});

it('renders empty child menus and keeps unknown plugin responses as text', async () => {
  const { index } = fixture(rendererFixture());
  expect((await index.dispatch('帮助 music')).value).toMatchObject({ type: 'html', data: {
    html: expect.stringContaining('暂无指令和子插件'), text: expect.stringContaining('=== music 指令菜单 ==='),
  } });
  expect((await index.dispatch('帮助 missing')).value).toBe('未找到插件: missing');
});

it('uses the current operation view to detect rendering resources', async () => {
  const { index, snapshot } = fixture(rendererFixture());
  const operation = { ...snapshot, resources: new Map() };
  expect(typeof (await index.dispatch('帮助', undefined, undefined, '', operation)).value).toBe('string');
});

function largeFixture(commandCount: number, pluginCount: number, renderer?: HtmlRendererHost) {
  const base = fixture(renderer);
  const root = base.snapshot.root;
  const commands = Array.from({ length: commandCount }, (_, i) => createCapabilitySlot({
    owner: root, feature: commandFeatureId, localName: `cmd-${String(i).padStart(3, '0')}`,
    source: `/commands/cmd-${i}/index.ts`,
    definition: defineCommand({ description: `功能 ${i}`, execute: () => { throw new Error('Menu must not execute a command'); } }),
  }));
  const tree = new Map(base.snapshot.tree);
  const children = Array.from({ length: pluginCount }, (_, i) => {
    const instanceKey = `plugin-${String(i).padStart(3, '0')}`;
    const id = childPluginId(root, instanceKey);
    tree.set(id, { id, instanceKey, parent: root, packageName: instanceKey, packageRoot: `/${instanceKey}`, children: [] });
    return id;
  });
  tree.set(root, { ...tree.get(root)!, children });
  const capabilities = new Map(base.snapshot.capabilities);
  for (const slot of commands) capabilities.set(slot.id, slot);
  const snapshot = { ...base.snapshot, tree, capabilities };
  return { ...base, snapshot, index: new CommandIndex(commands, snapshot, { keyword: '帮助' }) };
}

it.each([[95, 100], [0, 100], [100, 0]])('paginates %i commands and %i plugins without omission or duplication', async (commandCount, pluginCount) => {
  const { index } = largeFixture(commandCount, pluginCount);
  const found: string[] = [];
  const pages = Math.ceil((commandCount + pluginCount) / 30);
  for (let page = 1; page <= pages; page++) {
    const { value } = await index.dispatch(`帮助 --page ${page}`, undefined, undefined, '/');
    expect(typeof value).toBe('string');
    const text = String(value);
    expect(text).toContain(`第 ${page}/${pages} 页`);
    const entries = text.split('\n').filter(line => /^ {2}(?:\/cmd-|plugin-)\d{3}/u.test(line));
    expect(entries.length).toBeLessThanOrEqual(30);
    found.push(...entries.map(line => line.trim().split(/[ (]/u)[0]!));
    if (page > 1) expect(text).toContain(`上一页：/帮助 --page ${page - 1}`);
    if (page < pages) expect(text).toContain(`下一页：/帮助 --page ${page + 1}`);
  }
  expect(found).toHaveLength(commandCount + pluginCount);
  expect(new Set(found).size).toBe(commandCount + pluginCount);
});

it('keeps the image page and failed-render text page identical for a large catalog', async () => {
  const renderer = rendererFixture();
  const { index, snapshot, conversation, resources } = largeFixture(95, 100, renderer);
  const { value } = await index.dispatch('帮助 --page 4', undefined, undefined, '#');
  renderer.render.mockRejectedValueOnce(new Error('renderer failed'));
  const payload = await projectOutboundPayload(value, conversation, snapshot);
  const html = renderer.render.mock.calls[0]![0];
  expect(html.match(/class="entry"/gu)).toHaveLength(30);
  expect(html).toContain('04 / 07');
  expect(html).toContain('95 条指令');
  expect(html).toContain('100 个子插件');
  resources.delete(htmlRendererToken.id);
  const plain = await index.dispatch('帮助 --page 4', undefined, undefined, '#');
  expect(payload.payload).toEqual([{ type: 'text', data: { text: plain.value } }]);
});

it('preserves the plugin path and custom prefix in page navigation', async () => {
  const base = largeFixture(80, 0);
  const child = childPluginId(base.snapshot.root, 'music');
  const slots = [...base.snapshot.capabilities.values()].filter(slot => slot.feature === commandFeatureId)
    .map(slot => createCapabilitySlot({ ...slot, owner: child, definition: slot.definition as ReturnType<typeof defineCommand> }));
  const tree = new Map(base.snapshot.tree);
  tree.set(child, { id: child, instanceKey: 'music', parent: base.snapshot.root, packageName: 'music', packageRoot: '/music', children: [] });
  const snapshot = { ...base.snapshot, tree };
  const index = new CommandIndex(slots, snapshot, { keyword: '帮助' });
  const result = await index.dispatch('帮助 music --page 2', undefined, undefined, '!');
  expect(result.value).toContain('上一页：!帮助 music --page 1');
  expect(result.value).toContain('下一页：!帮助 music --page 3');
});

it.each(['0', '-1', '1.5', 'NaN', '9007199254740992', ''])('rejects invalid page %j without generating an image', async page => {
  const renderer = rendererFixture();
  const { index } = fixture(renderer);
  expect((await index.dispatch(`帮助 --page ${page}`)).value).toContain('页码必须是正整数');
  expect(renderer.render).not.toHaveBeenCalled();
});

it('reports the actual page count when the requested page is out of range', async () => {
  const { index } = largeFixture(80, 0);
  expect((await index.dispatch('帮助 --page 4')).value).toContain('共 3 页');
});

it('applies safe appearance settings from root configuration without changing text fallback', async () => {
  const { index, snapshot } = fixture(rendererFixture());
  const operation = { ...snapshot, config: new Map([[snapshot.root, { menuStyle: {
    title: '知音 <Atlas>', subtitle: '每天都有新发现', accentColor: '#dcad75',
    backgroundImage: 'https://example.com/art.webp?text=</style><script>alert(1)</script>',
  } }]]) };
  const { value } = await index.dispatch('帮助', undefined, undefined, '', operation);
  expect(value).toMatchObject({ type: 'html', data: {
    html: expect.stringContaining('知音 &lt;Atlas&gt;'), text: expect.stringContaining('=== root 指令菜单 ==='),
  } });
  const html = (value as { data: { html: string } }).data.html;
  expect(html).toContain('--accent:#dcad75');
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('</style><script>');
  const bad = { ...snapshot, config: new Map([[snapshot.root, { menuStyle: {
    accentColor: 'red;}body{display:none}', backgroundImage: 'javascript:alert(1)',
  } }]]) };
  const invalid = await index.dispatch('帮助', undefined, undefined, '', bad);
  expect((invalid.value as { data: { html: string } }).data.html).not.toContain('javascript:');
  expect((invalid.value as { data: { html: string } }).data.html).not.toContain('display:none');
});

it('uses copied page data for an asynchronous Root presenter without executing catalog commands', async () => {
  const { index, snapshot, conversation, resources } = largeFixture(35, 2);
  const presenter = vi.fn<CommandMenuPresenter>(async ({ page }) => jsx('text', {
    children: `${page.title}: ${page.commands.map(command => command.name).join(',')}`,
  }));
  resources.set(commandMenuPresentationToken.id, presenter);
  const result = await index.dispatch('帮助 --page 2', undefined, undefined, '/', snapshot);
  const reply = await commandMenuReply(result, index, snapshot, conversation, '/');
  expect(reply).toEqual(jsx('text', { children: 'root: /cmd-030,/cmd-031,/cmd-032,/cmd-033,/cmd-034' }));
  const { page } = presenter.mock.calls[0]![0];
  expect(page).toMatchObject({ page: 2, pages: 2, commandTotal: 35, pluginTotal: 2,
    plugins: [{ name: 'plugin-000' }, { name: 'plugin-001' }] });
  expect(page.commands).toHaveLength(5);
  expect(page.commands[0]).not.toHaveProperty('execute');
  expect(result.owner).toBe(snapshot.root);
});

it('resolves only the current Root selection and never promotes a sibling presenter', async () => {
  const { index, snapshot, conversation, resources } = fixture();
  const sibling = vi.fn<CommandMenuPresenter>(() => 'sibling');
  const old = vi.fn<CommandMenuPresenter>(() => 'old generation');
  resources.set(commandMenuPresentationToken.id, old);
  const child = childPluginId(snapshot.root, 'music');
  const selected = vi.fn<CommandMenuPresenter>(({ generation }) => `current generation ${generation}`);
  const current = { ...snapshot, generation: 2, resources: new Map([
    [snapshot.root, new Map([[commandMenuPresentationToken.id, selected]])],
    [child, new Map([[commandMenuPresentationToken.id, sibling]])],
  ]) };
  const result = await index.dispatch('帮助', undefined, undefined, '/', current);
  expect(await commandMenuReply(result, index, current, conversation, '/')).toBe('current generation 2');
  const removed = { ...current, resources: new Map([[child, current.resources.get(child)!]]) };
  expect(await commandMenuReply(result, index, removed, conversation, '/')).toBe(result.value);
  expect(old).not.toHaveBeenCalled();
  expect(sibling).not.toHaveBeenCalled();
});

it.each(['undefined', 'throw', 'mutate'] as const)('retains the built-in menu after presenter %s without logging content', async mode => {
  const { index, snapshot, conversation, resources } = fixture(rendererFixture());
  const warn = vi.spyOn(getLogger('command'), 'warn').mockImplementation(() => undefined);
  resources.set(commandMenuPresentationToken.id, ({ page, conversation: view }: Parameters<CommandMenuPresenter>[0]) => {
    if (mode === 'throw') throw new Error('secret from menu or conversation');
    if (mode === 'mutate') {
      expect(Reflect.set(view.endpoint, 'id', 'other-account')).toBe(false);
      expect(Reflect.set(page.commands[0]!, 'name', 'corrupt')).toBe(false);
      Object.assign(page, { page: 999 });
    }
    return undefined;
  });
  try {
    const result = await index.dispatch('帮助', undefined, undefined, '/', snapshot);
    expect(await commandMenuReply(result, index, snapshot, conversation, '/')).toBe(result.value);
    expect(result.menu?.page).toBe(1);
    expect(result.menu?.commands[0]?.name).toBe('/ping');
    expect(conversation.endpoint.id).not.toBe('other-account');
    expect(warn).toHaveBeenCalledTimes(mode === 'undefined' ? 0 : 1);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('测试连通性');
  } finally { warn.mockRestore(); }
});

it('preserves menuStyle and pagination when no presenter is selected', async () => {
  const { index, snapshot, conversation } = largeFixture(40, 0, rendererFixture());
  const current = { ...snapshot, config: new Map([[snapshot.root, {
    menuStyle: { title: '项目帮助', subtitle: '所有功能', accentColor: '#123456' },
  }]]) };
  for (const page of [1, 2]) {
    const result = await index.dispatch(`帮助 --page ${page}`, undefined, undefined, '/', current);
    expect(await commandMenuReply(result, index, current, conversation, '/')).toBe(result.value);
    expect(result.value).toMatchObject({ type: 'html', data: {
      html: expect.stringContaining('项目帮助'), text: expect.stringContaining(`第 ${page}/2 页`),
    } });
    expect(result.menu?.appearance).toEqual({ title: '项目帮助', subtitle: '所有功能', accentColor: '#123456' });
  }
});
