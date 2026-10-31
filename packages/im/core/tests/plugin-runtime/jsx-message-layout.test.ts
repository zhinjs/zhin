import { createCapabilitySlot, createSnapshotView, rootPluginId } from '@zhin.js/plugin-runtime';
import { ComponentIndex, componentFeatureId, defineComponent } from '@zhin.js/component';
import { Fragment, Html, Image, Mention, Card, Markdown, Face, Text, Share, jsx, renderToSegments } from '../../src/jsx.js';
import { OutboundRenderer } from '../../src/plugin-runtime/im/outbound-renderer.js';
import { component, raw } from '../../src/plugin-runtime/im/contracts.js';

it('lays out text and component-produced segments in one message, omitting null', async () => {
  const root = rootPluginId();
  const snapshot = createSnapshotView(0, {
    root, tree: new Map(), config: new Map(), resources: new Map(),
    capabilities: new Map(), projections: new Map(),
  });
  const image = { type: 'image', data: { media: { kind: 'url', value: 'https://example.com/a.png' } } };
  const node = jsx(Fragment, { children: ['hello', jsx(() => image, {}), jsx(() => null, {})] });
  expect(await new OutboundRenderer().render(node, { requester: root, snapshot: snapshot })).toEqual([
    { type: 'text', data: { text: 'hello' } }, image,
  ]);
});

it('maps intrinsic tags directly to Segment data and supports imported native aliases', async () => {
  const media = { kind: 'url' as const, value: 'https://example.com/a.png' };
  const share = { title: '海阔天空', url: 'https://music.163.com/#/song?id=387717', audio: 'https://example.com/song.mp3', config: { appid: 100495085 } };
  const tags = [
    ['text', { text: 'hello <world>' }], ['image', { media }], ['mention', { target: '123' }],
    ['face', { id: 42 }], ['share', share], ['card', { config: { wide_screen_mode: true } }],
    ['markdown', { content: '**hello**' }], ['audio', { media }], ['video', { media }],
    ['file', { media, name: 'test.txt' }], ['record', { media }], ['voice', { media }],
    ['reply', { message_id: '123' }], ['forward', { forward_id: 'f1' }], ['dice', { result: 6 }],
    ['rps', { result: 1 }], ['keyboard', { rows: [] }], ['action', { id: 'a', payload: 'p' }],
    ['link', { url: 'https://example.com' }], ['qrcode', { text: 'hello' }], ['tts', { text: 'hello' }],
  ] as const;
  expect(await renderToSegments(jsx(Fragment, { children: tags.map(([type, data]) => jsx(type, data)) })))
    .toEqual(tags.map(([type, data]) => ({ type, data })));
  expect(await renderToSegments(jsx(Fragment, { children: [
    jsx(Text, { children: 'hello <world>' }), jsx(Image, { src: media }), jsx(Mention, { target: '123' }),
    jsx(Face, { id: 42 }), jsx(Share, share), jsx(Card, { data: { config: { wide_screen_mode: true } } }),
    jsx(Markdown, { children: '**hello**' }),
  ] }))).toEqual(tags.slice(0, 7).map(([type, data]) => ({ type, data })));
});

it('only serializes the Html subtree and keeps text, numbers, async components and segments around it', async () => {
  const media = { kind: 'url' as const, value: 'https://example.com/a.png' };
  expect(await renderToSegments(jsx(Fragment, { children: [
    'hello <world>', jsx('image', { src: media }),
    jsx(Html, { width: 640, text: 'fallback', children: jsx('b', { children: '<ready>' }) }),
    jsx('html', { children: jsx('i', { children: 'done' }) }),
    jsx(async () => [Promise.resolve('tail'), null, false, 0], {}),
  ] }))).toEqual([
    { type: 'text', data: { text: 'hello <world>' } }, { type: 'image', data: { media } },
    { type: 'html', data: { html: '<b>&lt;ready&gt;</b>', width: 640, text: 'fallback' } },
    { type: 'html', data: { html: '<i>done</i>' } },
    { type: 'text', data: { text: 'tail' } }, { type: 'text', data: { text: '0' } },
  ]);
  await expect(renderToSegments(jsx('div', { children: 'outside' }))).rejects.toThrow('<html>');
  await expect(renderToSegments(jsx(Html, { children: jsx(Image, { src: media }) }))).rejects.toThrow();
});

it('loads a registered music tag that returns share and skips a registered null result', async () => {
  const root = rootPluginId();
  const share = { url: 'https://example.com/song', title: 'music', audio: 'https://example.com/song.mp3' };
  const music = createCapabilitySlot({ owner: root, feature: componentFeatureId, localName: 'music', source: '/components/music/index.ts',
    definition: defineComponent({ render: () => jsx('share', share) }),
  });
  const hidden = createCapabilitySlot({ owner: root, feature: componentFeatureId, localName: 'hidden', source: '/components/hidden/index.ts',
    definition: defineComponent({ render: () => null }),
  });
  const view = createSnapshotView(0, { root,
    tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'test', packageRoot: '/test', children: [] }]]),
    config: new Map([[root, {}]]), resources: new Map([[root, new Map()]]), capabilities: new Map([[music.id, music], [hidden.id, hidden]]), projections: new Map(),
  });
  const snapshot = createSnapshotView(0, { ...view, projections: new Map([[componentFeatureId, new ComponentIndex([music, hidden], view)]]) });
  expect(await new OutboundRenderer().render(
    jsx(Fragment, { children: ['hello', jsx('music', {}), jsx('hidden', {})] }),
    { requester: root, snapshot: snapshot },
  ))
    .toEqual([{ type: 'text', data: { text: 'hello' } }, { type: 'share', data: share }]);
});

it('rejects cycles, self-resolving thenables and runaway components', async () => {
  const children: unknown[] = []; children.push(children);
  await expect(renderToSegments(jsx(Fragment, { children: children as never }))).rejects.toThrow('Circular');
  const thenable = { then(resolve: (value: unknown) => void) { resolve(thenable); } };
  await expect(renderToSegments(jsx(Fragment, { children: thenable as never }))).rejects.toThrow('Circular');
  const Recursive = () => jsx(Recursive, {});
  await expect(renderToSegments(jsx(Recursive, {}), { maxDepth: 5 })).rejects.toThrow('maximum render depth');
});

it('rejects a named component cycle across ComponentCall without waiting on its own JSX cache', async () => {
  const root = rootPluginId();
  const node = jsx('cycle', {});
  const slots = [
    createCapabilitySlot({ owner: root, feature: componentFeatureId, localName: 'cycle', source: '/components/cycle/index.ts',
      definition: defineComponent({ render: () => component('bridge', {}) }) }),
    createCapabilitySlot({ owner: root, feature: componentFeatureId, localName: 'bridge', source: '/components/bridge/index.ts',
      definition: defineComponent({ render: () => node }) }),
  ];
  const view = createSnapshotView(0, { root,
    tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'test', packageRoot: '/test', children: [] }]]),
    config: new Map([[root, {}]]), resources: new Map([[root, new Map()]]),
    capabilities: new Map(slots.map(slot => [slot.id, slot])), projections: new Map(),
  });
  const snapshot = createSnapshotView(0, { ...view, projections: new Map([[componentFeatureId, new ComponentIndex(slots, view)]]) });
  await expect(new OutboundRenderer().render(node, { requester: root, snapshot: snapshot })).rejects.toThrow('Circular JSX component tree');
});

it('combines Text and Markdown children while rejecting embedded nontext message segments', async () => {
  expect(await renderToSegments(jsx(Fragment, { children: [
    jsx('text', { children: ['hello ', jsx(() => 'world', {}), 0] }),
    jsx('markdown', { width: 640, children: ['**hello', '**'] }),
  ] }))).toEqual([
    { type: 'text', data: { text: 'hello world0' } }, { type: 'markdown', data: { content: '**hello**', width: 640 } },
  ]);
  await expect(renderToSegments(jsx('text', { children: jsx('mention', { target: '123' }) }))).rejects.toThrow('must produce text');
});

it('preserves reserved native Card payload fields and rejects JSX card children', async () => {
  const data = { key: 'native-key', children: [{ key: 'nested', content: 'native data' }] };
  expect(await renderToSegments(jsx(Card, { data }))).toEqual([{ type: 'card', data }]);
  await expect(renderToSegments(jsx('card', { children: jsx('b', { children: 'layout' }) }))).rejects.toThrow('not children');
});

it('accepts MIME parameters in base64 image data URIs', async () => {
  expect(await renderToSegments(jsx(Image, { src: 'data:image/svg+xml;charset=utf-8;base64,PHN2Zy8+' }))).toEqual([
    { type: 'image', data: { media: { kind: 'base64', value: 'PHN2Zy8+', mime_type: 'image/svg+xml' } } },
  ]);
});

it('resolves raw content and nested ComponentCall arrays returned by registered JSX tags', async () => {
  const root = rootPluginId();
  const slots = [
    createCapabilitySlot({ owner: root, feature: componentFeatureId, localName: 'mixed', source: '/components/mixed/index.ts',
      definition: defineComponent({ render: () => [raw({ type: 'text', data: { text: 'raw' } }), [component('nested', {})]] }) }),
    createCapabilitySlot({ owner: root, feature: componentFeatureId, localName: 'nested', source: '/components/nested/index.ts',
      definition: defineComponent({ render: () => jsx('mention', { target: '123' }) }) }),
  ];
  const view = createSnapshotView(0, { root,
    tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'test', packageRoot: '/test', children: [] }]]),
    config: new Map([[root, {}]]), resources: new Map([[root, new Map()]]),
    capabilities: new Map(slots.map(slot => [slot.id, slot])), projections: new Map(),
  });
  const snapshot = createSnapshotView(0, { ...view, projections: new Map([[componentFeatureId, new ComponentIndex(slots, view)]]) });
  expect(await new OutboundRenderer().render(jsx('mixed', {}), { requester: root, snapshot: snapshot })).toEqual([
    { type: 'text', data: { text: 'raw' } }, { type: 'mention', data: { target: '123' } },
  ]);
});

it('preserves opaque raw payloads from a registered root JSX component', async () => {
  const root = rootPluginId();
  const payload = { native: { key: 'platform-message' } };
  const render = vi.fn(() => raw(payload));
  const slot = createCapabilitySlot({ owner: root, feature: componentFeatureId, localName: 'native', source: '/components/native/index.ts',
    definition: defineComponent({ render }) });
  const view = createSnapshotView(0, { root,
    tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'test', packageRoot: '/test', children: [] }]]),
    config: new Map([[root, {}]]), resources: new Map([[root, new Map()]]), capabilities: new Map([[slot.id, slot]]), projections: new Map(),
  });
  const snapshot = createSnapshotView(0, { ...view, projections: new Map([[componentFeatureId, new ComponentIndex([slot], view)]]) });
  const node = jsx('native', {});
  expect(await new OutboundRenderer().render([node, node], { requester: root, snapshot: snapshot })).toEqual([payload, payload]);
  expect(render).toHaveBeenCalledTimes(1);
});

it('limits registered JSX tag expansion to 32 component calls', async () => {
  const root = rootPluginId();
  const slots = Array.from({ length: 35 }, (_, i) => createCapabilitySlot({ owner: root, feature: componentFeatureId,
    localName: `part${i}`, source: `/components/part${i}/index.ts`,
    definition: defineComponent({ render: () => i === 34 ? 'end' : jsx(`part${i + 1}`, {}) }),
  }));
  const view = createSnapshotView(0, { root,
    tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'test', packageRoot: '/test', children: [] }]]),
    config: new Map([[root, {}]]), resources: new Map([[root, new Map()]]),
    capabilities: new Map(slots.map(slot => [slot.id, slot])), projections: new Map(),
  });
  const snapshot = createSnapshotView(0, { ...view, projections: new Map([[componentFeatureId, new ComponentIndex(slots, view)]]) });
  await expect(new OutboundRenderer().render(jsx('part0', {}), { requester: root, snapshot: snapshot })).rejects.toThrow('Component render depth exceeded 32');
});
