import {
  createCapabilitySlot,
  createSnapshotView,
  htmlRendererToken,
  rootPluginId,
  type CapabilityId,
  type CapabilitySlot,
  type HtmlRendererHost,
  type HtmlRenderOptions,
  type SnapshotState,
} from '@zhin.js/plugin-runtime';
import {
  AdapterIndex,
  Endpoint,
  adapterFeatureId,
  defineAdapter,
  endpointEventGatewayToken,
  type AdapterSegmentPolicy,
  type EndpointSendRequest,
} from '@zhin.js/adapter';
import { MiddlewareIndex, defineMiddleware, middlewareFeatureId } from '@zhin.js/middleware';
import { EndpointDeliveryError } from '@zhin.js/im-contract';
import { Fragment, jsx } from '../../src/jsx.js';
import { segment } from '../../src/utils.js';
import { OutboundDeliveryRuntime } from '../../src/plugin-runtime/im/outbound-delivery-runtime.js';
import { raw, type OutboundEnvelope, type SendContent } from '../../src/plugin-runtime/im/contracts.js';

const activeAdapters: AdapterIndex[] = [];
afterEach(async () => {
  await Promise.all(activeAdapters.splice(0).map((adapters) => adapters.stop()));
});

interface FixtureOptions {
  readonly segments?: AdapterSegmentPolicy;
  readonly renderer?: HtmlRendererHost;
  readonly replace?: unknown;
  readonly onSend?: (request: EndpointSendRequest) => string | Promise<string>;
}

/** Exercise real AdapterIndex admission and the production delivery/normalization chain. */
async function fixture(options: FixtureOptions = {}) {
  const root = rootPluginId();
  const sent: EndpointSendRequest[] = [];
  class MemoryEndpoint extends Endpoint<object> {
    readonly client = {};
    start() {}
    open() {}
    close() {}
    stop() {}
    async send(request: EndpointSendRequest) {
      sent.push(request);
      return options.onSend ? options.onSend(request) : 'message-1';
    }
  }
  const adapter = createCapabilitySlot({
    owner: root,
    feature: adapterFeatureId,
    localName: 'test',
    source: '/adapters/test/index.ts',
    definition: defineAdapter({
      capabilities: ['outbound'],
      segments: { outboundMedia: ['base64'], ...options.segments },
      create: () => new MemoryEndpoint(),
    }),
  });
  const middleware = createCapabilitySlot({
    owner: root,
    feature: middlewareFeatureId,
    localName: 'replace',
    source: '/middlewares/replace/index.ts',
    definition: defineMiddleware<OutboundEnvelope>({
      target: 'outbound',
      async handle({ input }, next) {
        if (options.replace !== undefined) input.replace(options.replace);
        await next();
      },
    }),
  });
  const resources = new Map([
    [endpointEventGatewayToken.id, { receive: async () => undefined } as unknown],
    ...(options.renderer ? [[htmlRendererToken.id, options.renderer] as const] : []),
  ]);
  const state: SnapshotState = {
    root,
    tree: new Map([[root, {
      id: root, instanceKey: 'root', packageName: '@test/neutral-endpoint', packageRoot: '/project', children: [],
    }]]),
    config: new Map([[root, {}]]),
    resources: new Map([[root, resources]]),
    capabilities: new Map<CapabilityId, Readonly<CapabilitySlot>>([
      [adapter.id, adapter], [middleware.id, middleware],
    ]),
    projections: new Map(),
  };
  const view = createSnapshotView(0, state);
  const adapters = await AdapterIndex.create([adapter], view, new AbortController().signal);
  activeAdapters.push(adapters);
  await adapters.start();
  adapters.open();
  const snapshot = createSnapshotView(0, {
    ...state,
    projections: new Map([
      [adapterFeatureId, adapters as unknown],
      [middlewareFeatureId, new MiddlewareIndex([middleware], view)],
    ]),
  });
  const record = vi.fn(async () => undefined);
  const publish = vi.fn();
  const runtime = new OutboundDeliveryRuntime({ record, publish, rememberFallback: () => undefined });
  return {
    sent,
    record,
    publish,
    send: (content: SendContent) => runtime.deliver({
      requester: root,
      conversation: { endpoint: { id: String(adapter.id), adapter: String(root) }, kind: 'private', id: 'room' },
      content,
    }, snapshot),
  };
}

function rasterRenderer() {
  return { render: vi.fn(async (_html: string, options?: HtmlRenderOptions) => ({
    data: Buffer.from('synthetic-png'),
    format: 'png' as const,
    width: options?.width ?? 540,
    height: 200,
    mimeType: 'image/png',
  })) };
}

describe('JSX outbound delivery through a real Endpoint', () => {
  it.each(['root', 'nested-mixed'] as const)('evaluates a reused %s replacement JSX root once and retains segment order', async (mode) => {
    const render = vi.fn(async () => jsx('b', { children: 'Ready' }));
    const node = jsx(render, {});
    const html = { type: 'html', data: { html: '<b>Ready</b>' } };
    const mention = segment.mention('alice');
    const image = segment.image({ kind: 'url', value: 'https://cdn.example/image.png' });
    const replace = mode === 'root' ? node : ['before', [node, [mention, image, node]], 'after'];
    const f = await fixture({ segments: { html: 'direct' }, replace });

    expect((await f.send(node)).status).toBe('sent');
    expect(render).toHaveBeenCalledTimes(1);
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]?.payload).toEqual(mode === 'root' ? [html] : [
      { type: 'text', data: { text: 'before' } }, html, mention, image, html,
      { type: 'text', data: { text: 'after' } },
    ]);
    expect(f.record).toHaveBeenCalledTimes(1);
    expect(f.publish).toHaveBeenCalledTimes(1);
  });

  it('applies text Markdown policy after flattening a nested middleware replacement', async () => {
    const f = await fixture({ segments: { markdown: 'text' }, replace: [[
      { type: 'markdown', data: { content: '**bold**' } }, ['tail'],
    ]] });
    expect((await f.send('original')).status).toBe('sent');
    expect(f.sent[0]?.payload).toEqual([
      { type: 'text', data: { text: 'bold' } }, { type: 'text', data: { text: 'tail' } },
    ]);
  });

  it('normalizes media and applies media fallback alongside direct HTML', async () => {
    const f = await fixture({ segments: { html: 'direct', outboundMedia: ['url'] } });
    expect((await f.send([
      jsx('b', { children: 'Ready' }),
      segment.image({ kind: 'base64', value: 'aGVsbG8=' }, 'image unavailable'),
      segment.image({ kind: 'url', value: 'https://cdn.example/image.png' }),
    ])).status).toBe('sent');
    expect(f.sent[0]?.payload).toEqual([
      { type: 'html', data: { html: '<b>Ready</b>' } },
      { type: 'text', data: { text: 'image unavailable' } },
      { type: 'image', data: { media: { kind: 'url', value: 'https://cdn.example/image.png' } } },
    ]);
  });

  it('does not let direct HTML bypass the declared supported-segment contract', async () => {
    const f = await fixture({ segments: { html: 'direct', supported: ['html', 'text'] } });
    const receipt = await f.send([jsx('b', { children: 'Ready' }), segment.mention('alice')]);
    expect(receipt.status).toBe('unsupported');
    expect(receipt.failure?.code).toBe('unsupported_operation');
    expect(f.sent).toEqual([]);
    expect(f.record).not.toHaveBeenCalled();
    expect(f.publish).not.toHaveBeenCalled();
  });

  it('does not let direct HTML bypass canonical validation for other segments', async () => {
    const f = await fixture({ segments: { html: 'direct' } });
    const receipt = await f.send([jsx('b', { children: 'Ready' }), { type: 'text', data: {} }]);
    expect(receipt.status).toBe('rejected');
    expect(f.sent).toEqual([]);
  });

  it.each(['direct', 'image', 'text'] as const)('uses declared HTML %s policy on a supplier-neutral Endpoint', async (html) => {
    const renderer = rasterRenderer();
    const f = await fixture({ segments: { html }, renderer });
    expect((await f.send(jsx('b', { children: 'Ready' }))).status).toBe('sent');
    expect(renderer.render).toHaveBeenCalledTimes(html === 'image' ? 1 : 0);
    expect(f.sent[0]?.payload).toEqual(html === 'direct'
      ? [{ type: 'html', data: { html: '<b>Ready</b>' } }]
      : html === 'text'
        ? [{ type: 'text', data: { text: 'Ready' } }]
        : [{ type: 'image', data: { media: {
          kind: 'base64', value: Buffer.from('synthetic-png').toString('base64'), mime_type: 'image/png', file_name: 'card.png',
        } } }]);
  });

  it('falls back without a renderer and prefers explicit HTML fallback text', async () => {
    const f = await fixture({ segments: { html: 'image' } });
    expect((await f.send(segment.html({ html: '<b>Ready</b>', text: 'explicit fallback' }))).status).toBe('sent');
    expect(f.sent[0]?.payload).toEqual([{ type: 'text', data: { text: 'explicit fallback' } }]);
  });

  it('does not rasterize for an Endpoint that only accepts URL media', async () => {
    const renderer = rasterRenderer();
    const f = await fixture({ segments: { html: 'image', outboundMedia: ['url'] }, renderer });
    expect((await f.send(jsx('b', { children: 'Ready' }))).status).toBe('sent');
    expect(renderer.render).not.toHaveBeenCalled();
    expect(f.sent[0]?.payload).toEqual([{ type: 'text', data: { text: 'Ready' } }]);
  });

  it.each([new Error('renderer diagnostic'), new RangeError('HTML sanitizer depth exceeded')])('falls back once when rasterization fails before an Endpoint attempt: %s', async (error) => {
    const renderer = { render: vi.fn(async () => { throw error; }) };
    const f = await fixture({ segments: { html: 'image' }, renderer });
    expect((await f.send(segment.html({ html: '<b>Ready</b>', text: 'render fallback' }))).status).toBe('sent');
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]?.payload).toEqual([{ type: 'text', data: { text: 'render fallback' } }]);
  });

  it.each(['transport', 'unknown', 'unconfirmed'] as const)('never sends fallback text after an %s Endpoint outcome', async (mode) => {
    const renderer = rasterRenderer();
    const f = await fixture({
      segments: { html: 'image' }, renderer,
      onSend: () => {
        if (mode === 'transport') throw new Error('transport reset');
        if (mode === 'unknown') throw new EndpointDeliveryError('endpoint_timeout', 'timeout', 'unknown');
        return '';
      },
    });
    const receipt = await f.send(segment.html({ html: '<b>Ready</b>', text: 'do not resend' }));
    expect(receipt.status).toBe('failed');
    expect(receipt.failure?.deliveryUnknown).toBe(true);
    expect(receipt.failure?.retryable).toBe(false);
    expect(renderer.render).toHaveBeenCalledTimes(1);
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]?.payload).toEqual([expect.objectContaining({ type: 'image' })]);
    expect(f.record).not.toHaveBeenCalled();
    expect(f.publish).not.toHaveBeenCalled();
  });

  it('suppresses an empty Fragment without calling the renderer or Endpoint', async () => {
    const renderer = rasterRenderer();
    const f = await fixture({ segments: { html: 'image' }, renderer });
    expect(await f.send(jsx(Fragment, { children: [false, null, undefined] }))).toEqual({ status: 'suppressed' });
    expect(renderer.render).not.toHaveBeenCalled();
    expect(f.sent).toEqual([]);
    expect(f.record).not.toHaveBeenCalled();
    expect(f.publish).not.toHaveBeenCalled();
  });

  it.each(['direct', 'image', 'text'] as const)('suppresses empty normalized content under %s HTML policy', async (html) => {
    const renderer = rasterRenderer();
    const f = await fixture({ segments: { html }, renderer });
    for (const content of [segment.text(''), [segment.text(''), segment.text('')], segment.html({ html: '' })]) {
      expect(await f.send(content)).toEqual({ status: 'suppressed' });
    }
    expect(renderer.render).not.toHaveBeenCalled();
    expect(f.sent).toEqual([]);
    expect(f.record).not.toHaveBeenCalled();
    expect(f.publish).not.toHaveBeenCalled();
  });

  it.each(['direct', 'image', 'text'] as const)('preserves explicit text fallback from empty HTML under %s policy', async (html) => {
    const f = await fixture({ segments: { html } });
    expect((await f.send(segment.html({ html: '', text: 'fallback' }))).status).toBe('sent');
    expect(f.sent[0]?.payload).toEqual([segment.text('fallback')]);
  });

  it('keeps nonempty direct HTML while suppressing its empty text-only fallback', async () => {
    const direct = await fixture({ segments: { html: 'direct' } });
    const content = segment.html({ html: '<div style="width:10px;height:10px;background:red"></div>' });
    expect((await direct.send(content)).status).toBe('sent');
    expect(direct.sent[0]?.payload).toEqual([content]);
    const text = await fixture({ segments: { html: 'text' } });
    expect(await text.send(content)).toEqual({ status: 'suppressed' });
    expect(text.sent).toEqual([]);
  });

  it('retains whitespace, nonempty text and nontext segments beside empty text', async () => {
    const f = await fixture();
    expect((await f.send([segment.text(''), segment.text(' '), segment.mention('alice')])).status).toBe('sent');
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]?.payload).toEqual([segment.text(' '), segment.mention('alice')]);
  });

  it.each(['native', 'text'] as const)('rejects malformed interactive replacements before Endpoint under %s policy', async (interactive) => {
    for (const replace of [
      { type: 'keyboard', data: { rows: 'broken' } },
      { type: 'keyboard', data: { rows: [[{ id: 'a', label: 'A' }]] } },
      { type: 'action', data: { id: 'a', payload: 42 } },
    ]) {
      const f = await fixture({ segments: { interactive }, replace });
      expect((await f.send('original')).status).toBe('rejected');
      expect(f.sent).toEqual([]);
      expect(f.record).not.toHaveBeenCalled();
      expect(f.publish).not.toHaveBeenCalled();
    }
  });

  it('rejects a JSX evaluation failure without sending its error or stack to chat', async () => {
    const renderer = rasterRenderer();
    const f = await fixture({ segments: { html: 'image' }, renderer });
    const render = vi.fn(async () => { throw new Error('private component diagnostic'); });
    const receipt = await f.send(jsx(render, {}));
    expect(receipt.status).toBe('rejected');
    expect(receipt.failure?.code).toBe('outbound_payload_rejected');
    expect(JSON.stringify(receipt)).not.toContain('private component diagnostic');
    expect(render).toHaveBeenCalledTimes(1);
    expect(renderer.render).not.toHaveBeenCalled();
    expect(f.sent).toEqual([]);
    expect(f.record).not.toHaveBeenCalled();
    expect(f.publish).not.toHaveBeenCalled();
  });

  it.each(['content', 'replacement', 'raw-content', 'raw-replacement'] as const)('rejects cyclic %s arrays before entering the Endpoint', async (mode) => {
    const content: SendContent[] = []; content.push(content);
    const wrapped = mode.startsWith('raw-') ? raw(content) : content;
    const f = await fixture(mode.includes('replacement') ? { replace: wrapped } : {});
    expect((await f.send(mode.includes('replacement') ? 'original' : wrapped)).status).toBe('rejected');
    expect(f.sent).toEqual([]);
    expect(f.record).not.toHaveBeenCalled();
    expect(f.publish).not.toHaveBeenCalled();
  });
});
