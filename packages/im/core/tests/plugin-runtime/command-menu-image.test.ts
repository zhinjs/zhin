import { CommandIndex, commandFeatureId, defineCommand } from '@zhin.js/command';
import {
  childPluginId, createCapabilitySlot, featureId, htmlRendererToken, rootPluginId,
  type HtmlRendererHost, type RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import type { ConversationRef } from '@zhin.js/im-contract';
import { projectOutboundPayload } from '../../src/plugin-runtime/im/outbound-projection.js';

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
    data: Buffer.from('png'), format: 'png', width: 860, height: 500, mimeType: 'image/png',
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
    fileName: 'command-menu.png', width: 860, html: expect.stringContaining('/ping'),
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
