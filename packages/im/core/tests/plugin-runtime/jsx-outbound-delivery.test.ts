import {
  createCapabilitySlot,
  createSnapshotView,
  htmlRendererToken,
  childPluginId,
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
import { EndpointDeliveryError, type ConversationRef } from '@zhin.js/im-contract';
import { getLogger } from '@zhin.js/logger';
import { Fragment, Html, jsx } from '../../src/jsx.js';
import { segment } from '../../src/utils.js';
import { OutboundDeliveryRuntime } from '../../src/plugin-runtime/im/outbound-delivery-runtime.js';
import { OutboundRenderer } from '../../src/plugin-runtime/im/outbound-renderer.js';
import { raw, type OutboundEnvelope, type SendContent } from '../../src/plugin-runtime/im/contracts.js';
import { outboundPresentationToken, type OutboundPresentation } from '../../src/plugin-runtime/im/outbound-presentation.js';
import { JsxButtonRegistry } from '../../src/plugin-runtime/im/jsx-button-registry.js';

const activeAdapters: AdapterIndex[] = [];
afterEach(async () => {
  await Promise.all(activeAdapters.splice(0).map((adapters) => adapters.stop()));
});

interface FixtureOptions {
  readonly segments?: AdapterSegmentPolicy;
  readonly renderer?: HtmlRendererHost;
  readonly replace?: unknown;
  readonly mutate?: (payload: unknown) => void;
  readonly onSend?: (request: EndpointSendRequest) => string | Promise<string>;
  readonly presentation?: OutboundPresentation;
  readonly childPresentation?: OutboundPresentation;
  readonly target?: Pick<ConversationRef, 'kind' | 'id' | 'parent' | 'threadId'>;
  readonly generation?: number;
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
        options.mutate?.(input.payload);
        await next();
      },
    }),
  });
  const resources = new Map([
    [endpointEventGatewayToken.id, { receive: async () => undefined } as unknown],
    ...(options.renderer ? [[htmlRendererToken.id, options.renderer] as const] : []),
    ...(options.presentation ? [[outboundPresentationToken.id, options.presentation] as const] : []),
  ]);
  const state: SnapshotState = {
    root,
    tree: new Map([[root, {
      id: root, instanceKey: 'root', packageName: '@test/neutral-endpoint', packageRoot: '/project', children: [],
    }]]),
    config: new Map([[root, {}]]),
    resources: new Map([[root, resources], ...(options.childPresentation
      ? [[childPluginId(root, 'child'), new Map([[outboundPresentationToken.id, options.childPresentation]])] as const] : [])]),
    capabilities: new Map<CapabilityId, Readonly<CapabilitySlot>>([
      [adapter.id, adapter], [middleware.id, middleware],
    ]),
    projections: new Map(),
  };
  const view = createSnapshotView(options.generation ?? 0, state);
  const adapters = await AdapterIndex.create([adapter], view, new AbortController().signal);
  activeAdapters.push(adapters);
  await adapters.start();
  adapters.open();
  const snapshot = createSnapshotView(options.generation ?? 0, {
    ...state,
    projections: new Map([
      [adapterFeatureId, adapters as unknown],
      [middlewareFeatureId, new MiddlewareIndex([middleware], view)],
    ]),
  });
  const record = vi.fn(async () => undefined);
  const publish = vi.fn();
  const buttons = new JsxButtonRegistry();
  const activate = vi.fn<(payloads: ReadonlySet<string>) => void>();
  const rememberFallback = vi.fn<(conversation: ConversationRef, generation: number, map: Record<string, string>) => void>();
  const runtime = new OutboundDeliveryRuntime({ record, publish, rememberFallback,
    prepareButtons(request, current) {
      const batch = buttons.prepare(request, current);
      return { bind: batch.bind, activate(payloads) { activate(payloads); return batch.activate(payloads); } };
    },
  });
  const target = options.target ?? { kind: 'private' as const, id: 'room' };
  return {
    sent,
    record,
    publish,
    activate,
    rememberFallback,
    preview: (content: SendContent, signal?: AbortSignal) => new OutboundRenderer().preview(content, root, snapshot,
      { endpoint: { id: String(adapter.id), adapter: 'test' }, ...target }, { signal }),
    send: (content: SendContent) => runtime.deliver({
      requester: root,
      conversation: { endpoint: { id: String(adapter.id), adapter: String(root) }, ...target },
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
  it('applies Root text preferences before rasterizing and reuses the same decision after JSX replacement', async () => {
    const renderer = rasterRenderer();
    const preferences = { html: 'text' as const, markdown: 'text' as const, interactive: 'text' as const };
    const presentation = vi.fn(() => preferences);
    const original = vi.fn(() => [jsx(Html, { children: 'Original' }), jsx('button', { label: 'Discarded', onClick: vi.fn() })]);
    const replacement = vi.fn(() => [jsx(Html, { children: 'Replacement' }),
      segment.markdown('**ready**'), jsx('button', { label: 'Retry', onClick: vi.fn() })]);
    const f = await fixture({ renderer, presentation,
      segments: { html: 'image', markdown: 'native', interactive: 'native', supported: ['text', 'image', 'markdown', 'keyboard'] },
      replace: jsx(replacement, {}),
      mutate() { Object.assign(preferences, { html: 'default', markdown: 'default', interactive: 'default' }); },
    });
    expect((await f.send(jsx(original, {}))).status).toBe('sent');
    expect(presentation).toHaveBeenCalledTimes(1);
    expect(original).toHaveBeenCalledTimes(1);
    expect(replacement).toHaveBeenCalledTimes(1);
    expect(renderer.render).not.toHaveBeenCalled();
    expect(f.sent).toHaveLength(1);
    expect(f.sent[0]?.payload).toEqual([segment.text('Replacement'), segment.text('ready'), expect.objectContaining({ type: 'text' })]);
    expect(f.activate).toHaveBeenCalledTimes(1);
    expect([...f.activate.mock.calls[0]![0]]).toEqual(Object.values(f.rememberFallback.mock.calls[0]![2]));
    expect(f.record).toHaveBeenCalledTimes(1);
  });

  it('shares a read-only, precise conversation decision with previews without middleware or transport', async () => {
    const renderer = rasterRenderer();
    const target = { kind: 'channel' as const, id: 'room', parent: { kind: 'group' as const, id: 'guild' }, threadId: 'topic' };
    const presentation = vi.fn<OutboundPresentation>(context => {
      expect(context).toMatchObject({ requester: rootPluginId(), generation: 7, conversation: target });
      expect(Object.isFrozen(context)).toBe(true);
      expect(Object.isFrozen(context.conversation)).toBe(true);
      expect(Object.isFrozen(context.conversation.endpoint)).toBe(true);
      expect(Object.isFrozen(context.conversation.parent)).toBe(true);
      expect(context.conversation.parent).not.toBe(target.parent);
      return context.conversation.threadId === 'topic' ? { html: 'text', markdown: 'text', interactive: 'text' } : undefined;
    });
    const mutate = vi.fn();
    const f = await fixture({ renderer, presentation, target, generation: 7, mutate,
      segments: { html: 'image', markdown: 'native', interactive: 'native' } });
    const content = [jsx(Html, { children: 'Report' }), segment.markdown('**ready**')];
    const preview = await f.preview(content);
    expect(presentation).toHaveBeenCalledTimes(1);
    expect(mutate).not.toHaveBeenCalled();
    expect(f.sent).toEqual([]);
    expect(f.activate).not.toHaveBeenCalled();
    expect((await f.send(content)).status).toBe('sent');
    expect(presentation).toHaveBeenCalledTimes(2);
    expect(renderer.render).not.toHaveBeenCalled();
    expect(f.sent[0]?.payload).toEqual(preview.payload);
    expect(f.publish).toHaveBeenCalledWith(expect.objectContaining({ rendering: preview.rendering }));
    expect(Object.isFrozen(target.parent)).toBe(false);
  });

  it.each(['undefined', 'default', 'throw', 'invalid', 'async'] as const)('falls back to built-in presentation for %s without repeating business or delivery', async mode => {
    const renderer = rasterRenderer();
    const presentation = vi.fn(() => {
      if (mode === 'throw') throw new Error('private policy detail');
      if (mode === 'invalid') return { html: 'direct' };
      if (mode === 'async') return Promise.reject(new Error('private async policy detail'));
      return mode === 'default' ? { html: 'default' } : undefined;
    }) as unknown as OutboundPresentation;
    const render = vi.fn(() => jsx(Html, { children: 'Report' }));
    const warn = vi.spyOn(getLogger('im.outbound'), 'warn').mockImplementation(() => undefined);
    try {
      const f = await fixture({ renderer, presentation, segments: { html: 'image' } });
      expect((await f.send(jsx(render, {}))).status).toBe('sent');
      expect(presentation).toHaveBeenCalledTimes(1);
      expect(render).toHaveBeenCalledTimes(1);
      expect(renderer.render).toHaveBeenCalledTimes(1);
      expect(f.sent).toHaveLength(1);
      expect(f.sent[0]?.payload).toEqual([expect.objectContaining({ type: 'image' })]);
      expect(JSON.stringify(warn.mock.calls)).not.toContain('private');
      expect(JSON.stringify(warn.mock.calls)).not.toContain('Report');
      if (mode === 'throw' || mode === 'invalid' || mode === 'async') {
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith(expect.stringMatching(/outbound_presentation.*fallback.*policy_failed/s));
      } else expect(warn).not.toHaveBeenCalled();
    } finally { warn.mockRestore(); }
  });

  it.each(['html', 'markdown', 'interactive'] as const)('does not let %s text preferences bypass supported segment admission', async kind => {
    const renderer = rasterRenderer();
    const f = await fixture({ renderer, presentation: () => ({ [kind]: 'text' }),
      segments: { html: 'direct', markdown: 'native', interactive: 'native', supported: ['html', 'markdown', 'keyboard'] } });
    const content = kind === 'html' ? jsx(Html, { children: 'Report' })
      : kind === 'markdown' ? segment.markdown('**Report**') : jsx('button', { label: 'Report', onClick: vi.fn() });
    expect(await f.send(content)).toMatchObject({ status: 'unsupported', failure: { code: 'unsupported_operation' } });
    await expect(f.preview(content)).rejects.toMatchObject({ code: 'unsupported_operation' });
    expect(renderer.render).not.toHaveBeenCalled();
    expect(f.sent).toEqual([]);
    expect(f.activate).not.toHaveBeenCalled();
  });

  it.each(['direct', 'image'] as const)('keeps mixed %s HTML, Markdown and buttons readable on a strict text target', async html => {
    const renderer = rasterRenderer();
    const f = await fixture({ renderer, presentation: () => ({ html: 'text', markdown: 'text', interactive: 'text' }),
      segments: { html, markdown: 'native', interactive: 'native', supported: ['text'] } });
    const content = [jsx(Html, { children: 'Report' }), segment.markdown('**ready**'),
      jsx('button', { label: 'Continue', onClick: vi.fn() }), jsx('button', { label: 'Previous', disabled: true, onClick: vi.fn() })];
    const preview = await f.preview(content);
    expect((await f.send(content)).status).toBe('sent');
    expect(f.sent[0]?.payload).toEqual(preview.payload);
    expect(f.sent[0]?.payload).toEqual([segment.text('Report'), segment.text('ready'),
      expect.objectContaining({ type: 'text', data: { text: expect.stringContaining('Continue') } }),
      expect.objectContaining({ type: 'text', data: { text: expect.stringContaining('Previous (不可用)') } })]);
    expect(renderer.render).not.toHaveBeenCalled();
    expect([...f.activate.mock.calls[0]![0]]).toHaveLength(1);
  });

  it('resolves only the current snapshot Root policy, never a child override or another generation', async () => {
    const renderer = rasterRenderer();
    const childPresentation = vi.fn<OutboundPresentation>(() => ({ html: 'text' }));
    const first = await fixture({ renderer, childPresentation, generation: 3, segments: { html: 'image' } });
    const presentation = vi.fn<OutboundPresentation>(() => ({ html: 'text' }));
    const second = await fixture({ renderer, presentation, generation: 4, segments: { html: 'image' } });
    const content = jsx(Html, { children: 'Report' });
    await first.send(content);
    await second.send(content);
    await first.send(content);
    expect(childPresentation).not.toHaveBeenCalled();
    expect(presentation).toHaveBeenCalledTimes(1);
    expect(presentation.mock.calls[0]?.[0].generation).toBe(4);
    expect(renderer.render).toHaveBeenCalledTimes(2);
    expect(second.sent[0]?.payload).toEqual([segment.text('Report')]);
  });

  it('keeps one transport attempt when the selected text presentation has an unknown delivery outcome', async () => {
    const renderer = rasterRenderer();
    const presentation = vi.fn<OutboundPresentation>(() => ({ html: 'text' }));
    const f = await fixture({ renderer, presentation, segments: { html: 'image' }, onSend() {
      throw new EndpointDeliveryError('endpoint_timeout', 'timeout', 'unknown');
    } });
    expect(await f.send(jsx(Html, { children: 'Report' }))).toMatchObject({ status: 'failed', failure: { deliveryUnknown: true, retryable: false } });
    expect(presentation).toHaveBeenCalledTimes(1);
    expect(renderer.render).not.toHaveBeenCalled();
    expect(f.sent).toHaveLength(1);
    expect(f.record).not.toHaveBeenCalled();
  });

  it('cancels a target preview while the HTML host is pending without text fallback or sending', async () => {
    const controller = new AbortController();
    let started!: () => void, rejectHost!: (error: Error) => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const host = { render: vi.fn((_html: string, options?: HtmlRenderOptions) => {
      expect(options?.signal).toBe(controller.signal);
      started();
      return new Promise<never>((_resolve, reject) => { rejectHost = reject; });
    }) };
    const f = await fixture({ segments: { html: 'image' }, renderer: host });
    const preview = f.preview(jsx(Html, { children: 'Pending' }), controller.signal);
    const reason = new Error('preview canceled');
    const rejected = expect(preview).rejects.toBe(reason);
    await entered;
    controller.abort(reason);
    await rejected;
    rejectHost(new Error('late renderer failure'));
    await Promise.resolve();
    expect(f.sent).toEqual([]);
    expect(f.publish).not.toHaveBeenCalled();
    expect(f.record).not.toHaveBeenCalled();
  });
  it.each(['array', 'text'] as const)('drops discarded fallback diagnostics after middleware mutates %s in place', async mode => {
    const f = await fixture({ mutate(payload) {
      if (!Array.isArray(payload)) throw new Error('Expected normalized segments');
      if (mode === 'array') payload.splice(0, payload.length, segment.text('replacement'));
      else payload[0].data.text = 'replacement';
    } });
    expect((await f.send(segment.html({ html: '<b>original</b>', text: 'original' }))).status).toBe('sent');
    expect(f.sent[0]?.payload).toEqual([segment.text('replacement')]);
    expect(f.publish).toHaveBeenCalledWith(expect.objectContaining({ rendering: { forms: ['text'], fallbacks: [] } }));
  });
  it('previews final target policy without transport or live callbacks and agrees with sent diagnostics', async () => {
    const f = await fixture({ segments: { html: 'text', interactive: 'text', markdown: 'text' } });
    const content = [jsx(Html, { children: jsx('b', { children: 'Status' }) }),
      { type: 'markdown', data: { content: '**ready**' } },
      jsx('button', { label: 'retry', onClick: vi.fn() })];
    const preview = await f.preview(content);
    expect(preview.payload).toEqual([
      { type: 'text', data: { text: 'Status' } },
      { type: 'text', data: { text: 'ready' } },
      expect.objectContaining({ type: 'text' }),
    ]);
    expect(preview.rendering).toEqual({ forms: ['text'], fallbacks: [
      'markdown_text_policy', 'html_text_policy', 'interactive_text_policy',
    ] });
    expect(f.sent).toEqual([]);
    expect(f.publish).not.toHaveBeenCalled();
    expect(f.record).not.toHaveBeenCalled();
    expect((await f.send(content.slice(0, 2))).status).toBe('sent');
    expect(f.publish).toHaveBeenCalledWith(expect.objectContaining({ rendering: {
      forms: ['text'], fallbacks: ['markdown_text_policy', 'html_text_policy'],
    } }));
  });

  it('reports raster images and drops discarded initial fallbacks after middleware replaces the content', async () => {
    const renderer = rasterRenderer();
    const image = await fixture({ segments: { html: 'image' }, renderer });
    await image.send(jsx(Html, { children: 'Status' }));
    expect(image.publish).toHaveBeenCalledWith(expect.objectContaining({ rendering: { forms: ['image'], fallbacks: [] } }));
    const replaced = await fixture({ segments: { html: 'image' }, replace: 'replaced' });
    await replaced.send(jsx(Html, { children: 'Discarded' }));
    expect(replaced.publish).toHaveBeenCalledWith(expect.objectContaining({ rendering: { forms: ['text'], fallbacks: [] } }));
    const failed = await fixture({ renderer: { render: async () => { throw new Error('private renderer details'); } } });
    await failed.send(jsx(Html, { children: 'Fallback' }));
    expect(failed.publish).toHaveBeenCalledWith(expect.objectContaining({ rendering: { forms: ['text'], fallbacks: ['renderer_failed'] } }));
    expect(JSON.stringify(failed.publish.mock.calls)).not.toContain('private renderer details');
  });
  it.each(['root', 'nested-mixed'] as const)('evaluates a reused %s replacement JSX root once and retains segment order', async (mode) => {
    const render = vi.fn(async () => jsx(Html, { children: jsx('b', { children: 'Ready' }) }));
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
      jsx(Html, { children: jsx('b', { children: 'Ready' }) }),
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
    const receipt = await f.send([jsx(Html, { children: jsx('b', { children: 'Ready' }) }), segment.mention('alice')]);
    expect(receipt.status).toBe('unsupported');
    expect(receipt.failure?.code).toBe('unsupported_operation');
    expect(f.sent).toEqual([]);
    expect(f.record).not.toHaveBeenCalled();
    expect(f.publish).not.toHaveBeenCalled();
  });

  it('does not let direct HTML bypass canonical validation for other segments', async () => {
    const f = await fixture({ segments: { html: 'direct' } });
    const receipt = await f.send([jsx(Html, { children: jsx('b', { children: 'Ready' }) }), { type: 'text', data: {} }]);
    expect(receipt.status).toBe('rejected');
    expect(f.sent).toEqual([]);
  });

  it.each(['direct', 'image', 'text'] as const)('uses declared HTML %s policy on a supplier-neutral Endpoint', async (html) => {
    const renderer = rasterRenderer();
    const f = await fixture({ segments: { html }, renderer });
    expect((await f.send(jsx(Html, { children: jsx('b', { children: 'Ready' }) }))).status).toBe('sent');
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
    expect((await f.send(jsx(Html, { children: jsx('b', { children: 'Ready' }) }))).status).toBe('sent');
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
    const warn = vi.spyOn(getLogger('im.outbound'), 'warn').mockImplementation(() => undefined);
    const render = vi.fn(async () => { throw new Error('private component diagnostic'); });
    const receipt = await f.send(jsx(render, {}));
    expect(receipt.status).toBe('rejected');
    expect(receipt.failure?.code).toBe('outbound_payload_rejected');
    expect(JSON.stringify(receipt)).not.toContain('private component diagnostic');
    // The operator still learns why: the reason goes to the log, never to chat.
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/outbound_payload_rejected.*stage: render.*private component diagnostic/s));
    warn.mockRestore();
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

it('delivers sparse raw payloads while still rejecting explicit undefined before Endpoint', async () => {
  const sparse = new Array<unknown>(4);
  sparse[1] = segment.text('sparse');
  sparse[3] = [segment.text('nested')];
  const f = await fixture({ segments: { html: 'direct' } });
  expect((await f.send(raw(sparse))).status).toBe('sent');
  expect(f.sent[0]?.payload).toEqual([segment.text('sparse'), segment.text('nested')]);
  const invalid = await fixture({ segments: { html: 'direct' } });
  expect(await invalid.send(raw([segment.text('before'), undefined]))).toMatchObject({ status: 'rejected', failure: { code: 'outbound_payload_rejected' } });
  expect(invalid.sent).toHaveLength(0);
});
