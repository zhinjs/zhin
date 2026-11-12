import { EventEmitter } from 'node:events';
import { Adapter, AdapterIndex, adapterFeatureId, createEndpointSpecification, defineAdapter,
  endpointEventGatewayToken, endpointSpec, type Endpoint, type EndpointSendRequest, type EndpointStreaming } from '@zhin.js/adapter';
import { SnapshotStore, createCapabilitySlot, createSnapshotView, rootPluginId,
  type SnapshotState, type TokenId } from '@zhin.js/plugin-runtime';
import { EndpointDeliveryError, MemoryConversationEventStore, type MessageRef, type Segment } from '@zhin.js/im-contract';
import { MiddlewareIndex, defineMiddleware, middlewareFeatureId, type MiddlewareDefinition } from '@zhin.js/middleware';
import { MemoryDesiredRepository } from '../../../../../plugins/adapters/test-utils/desired-repository.js';
import { ImRuntime, type OutboundEnvelope, type ReplyStreamSnapshot } from '../../src/plugin-runtime/im/index.js';

async function fixture(send: (request: EndpointSendRequest) => Promise<string> = async () => 'sent', options: {
  streaming?: EndpointStreaming; middleware?: MiddlewareDefinition[]; events?: MemoryConversationEventStore;
  nativeMarkdown?: boolean; nativeKeyboard?: boolean;
} = {}) {
  const root = rootPluginId(), im = new ImRuntime({ conversationEvents: options.events }), repository = new MemoryDesiredRepository();
  repository.snapshot = undefined;
  const calls: Array<{ account: string; message: string }> = [];
  class NativeEndpoint extends EventEmitter implements Endpoint {
    readonly [endpointSpec];
    constructor(readonly account: string) {
      super();
      this[endpointSpec] = createEndpointSpecification(this, {
        start() {}, open() {}, close() {}, stop() {}, send,
        streaming: options.streaming,
        control: { recall: async ({ message }) => { calls.push({ account: this.account, message: message.id }); } },
        profile: {
          writableFields: ['nickname'],
          read: async () => ({ nickname: this.account }),
          write: async ({ change }) => change.field === 'nickname'
            ? { status: 'updated', profile: { nickname: change.value } }
            : { status: 'rejected' },
        },
      });
    }
  }
  class NativeAdapter extends Adapter<NativeEndpoint> {
    protected createEndpoint(config: Readonly<Record<string, unknown>>) { return new NativeEndpoint(String(config.id)); }
  }
  const adapter = new NativeAdapter();
  const slot = createCapabilitySlot({ owner: root, feature: adapterFeatureId, localName: 'test', source: '/fixture/adapters/test/index.ts',
    definition: defineAdapter({ capabilities: ['inbound', 'outbound'], operations: ['recall'],
      ...(options.nativeMarkdown || options.nativeKeyboard ? { segments: {
        ...(options.nativeMarkdown ? { markdown: 'native' as const } : {}),
        ...(options.nativeKeyboard ? { interactive: 'native' as const } : {}),
      } } : {}), createAdapter: () => adapter }) });
  const middlewares = (options.middleware ?? []).map((definition, index) => createCapabilitySlot({ owner: root, feature: middlewareFeatureId,
    localName: `middleware-${index}`, source: `/fixture/middlewares/${index}/index.ts`, definition }));
  const state: SnapshotState = { root,
    tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'fixture', packageRoot: '/fixture', children: [] }]]),
    config: new Map([[root, { endpoints: [{ id: 'one' }, { id: 'two' }] }]]), capabilities: new Map([[slot.id, slot], ...middlewares.map(value => [value.id, value] as const)]),
    projections: new Map(), resources: new Map([[root, new Map<TokenId, unknown>([[endpointEventGatewayToken.id, im.endpointEvents]])]]),
  };
  const index = await AdapterIndex.create([slot], createSnapshotView(0, state), new AbortController().signal, { repository });
  const projections: SnapshotState['projections'] = new Map([[adapterFeatureId, index]]);
  if (middlewares.length) (projections as Map<unknown, unknown>).set(middlewareFeatureId, new MiddlewareIndex(middlewares, createSnapshotView(0, state)));
  const store = new SnapshotStore({ ...state, projections });
  im.attach(store); await index.activate(new AbortController().signal);
  const one = adapter.list().find(row => row.endpointId === 'one')!, two = adapter.list().find(row => row.endpointId === 'two')!;
  const target = { endpoint: { id: one.canonicalId, adapter: 'test' }, kind: 'group' as const, id: 'room',
    parent: { kind: 'channel' as const, id: 'container' }, threadId: 'topic' };
  return { im, adapter, index, store, state, one, two, calls, target, async close() { await index.stop(); await store.close(); } };
}

function streamSnapshot(text: string, revision: number, complete = false, tail: readonly Segment[] = []): ReplyStreamSnapshot {
  return { revision, messages: [{ key: 'answer', complete,
    segments: [{ key: 'body', complete: complete || tail.length > 0, value: { type: 'text', data: { text } } },
      ...tail.map((value, index) => ({ key: `tail-${index}`, complete, value }))],
  }] };
}

function nativeStreaming() {
  const frames: Array<{ kind: 'write' | 'finish'; text: string; id: string }> = [];
  const cancelled = vi.fn();
  let count = 0;
  const streaming: EndpointStreaming = { mode: 'native', open() {
    const id = `stream-${++count}`;
    return { write: async text => { frames.push({ kind: 'write', text, id }); return { status: 'sent', messageId: id, acceptedText: text }; },
      finish: async text => { frames.push({ kind: 'finish', text, id }); return { status: 'sent', messageId: id, acceptedText: text }; }, cancel: cancelled };
  } };
  return { frames, cancelled, streaming };
}

it.each(['finish', 'cancel'] as const)('keeps a long native stream interval across timer chunks until %s', async ending => {
  const native = nativeStreaming(), timerLimit = 2_147_483_647;
  const f = await fixture(async () => 'ordinary', { streaming: { ...native.streaming, minIntervalMs: timerLimit + 1000 } });
  const operation = f.im.endpoints.captureOperation({ target: f.target, client: f.index.clientById(f.one.canonicalId) });
  vi.useFakeTimers(); vi.setSystemTime(1);
  try {
    const stream = operation.openReplyStream!()!;
    stream.update(streamSnapshot('first', 1));
    await vi.advanceTimersByTimeAsync(0);
    expect(native.frames.map(frame => frame.text)).toEqual(['first']);
    const finishing = stream.finish(streamSnapshot('first second', 2, true));
    await vi.advanceTimersByTimeAsync(1);
    expect(native.frames).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(timerLimit - 1);
    expect(native.frames).toHaveLength(1);
    if (ending === 'cancel') {
      expect(await stream.cancel()).toMatchObject({ status: 'failed', failure: { code: 'cancelled' } });
      expect(await finishing).toMatchObject({ status: 'failed', failure: { code: 'cancelled' } });
    } else {
      await vi.advanceTimersByTimeAsync(999);
      expect(native.frames).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(await finishing).toMatchObject({ status: 'sent' });
      expect(native.frames.map(frame => frame.text)).toEqual(['first', 'first second']);
    }
    expect(vi.getTimerCount()).toBe(0);
  } finally { operation.release(); vi.useRealTimers(); await f.close(); }
});

it('coalesces intermediate candidates through incremental middleware and persists the confirmed final body once', async () => {
  const native = nativeStreaming(), events = new MemoryConversationEventStore();
  const ordinary = vi.fn(async () => 'ordinary');
  const f = await fixture(ordinary, { streaming: native.streaming, events, middleware: [defineMiddleware<OutboundEnvelope>({
    target: 'outbound', incremental: true,
    async handle({ input }, next) {
      const segments = input.payload as Segment[];
      input.replace(segments.map(segment => segment.type === 'text'
        ? { type: 'text', data: { text: `safe:${String(segment.data.text)}` } } : segment));
      await next();
    },
  })] });
  const operation = f.im.endpoints.captureOperation({ target: f.target, client: f.index.clientById(f.one.canonicalId) });
  try {
    const stream = operation.openReplyStream!()!;
    stream.update(streamSnapshot('first', 1));
    stream.update(streamSnapshot('first second', 2));
    stream.update(streamSnapshot('first second third', 3));
    stream.update(streamSnapshot('stale revision', 2));
    const receipt = await stream.finish(streamSnapshot('first second third final', 4, true));
    expect(receipt.status).toBe('sent');
    expect(native.frames.at(-1)).toMatchObject({ kind: 'finish', text: 'safe:first second third final' });
    expect(native.frames.some(frame => frame.text === 'safe:first second')).toBe(false);
    expect(ordinary).not.toHaveBeenCalled();
    expect(stream.confirmed).toHaveLength(1);
    expect(stream.confirmed[0]!.segments).toEqual([{ type: 'text', data: { text: 'safe:first second third final' } }]);
    expect((await events.listMessages!(f.target, undefined, 50))).toHaveLength(1);
    expect((await events.getMessage({ conversation: f.target, id: 'stream-1' }))!.segments).toEqual(stream.confirmed[0]!.segments);
    await stream.finish(streamSnapshot('first second third final', 4, true));
    stream.update(streamSnapshot('after finalization', 5));
    expect(native.frames.filter(frame => frame.kind === 'finish')).toHaveLength(1);
  } finally { operation.release(); await f.close(); }
});

it('preserves confirmed addressing when an incremental middleware changes the prefix of an existing container', async () => {
  const native = nativeStreaming();
  let target = 'first-target';
  const f = await fixture(async () => 'ordinary', { streaming: native.streaming, middleware: [defineMiddleware<OutboundEnvelope>({
    target: 'outbound', incremental: true,
    async handle({ input }, next) { input.replace([{ type: 'mention', data: { target } }, ...input.payload as Segment[]]); await next(); },
  })] });
  const operation = f.im.endpoints.captureOperation({ target: f.target, client: f.index.clientById(f.one.canonicalId) });
  try {
    const stream = operation.openReplyStream!()!;
    stream.update(streamSnapshot('shown', 1));
    await vi.waitFor(() => expect(native.frames).toHaveLength(1));
    target = 'different-target';
    expect(await stream.finish(streamSnapshot('shown final', 2, true))).toMatchObject({ status: 'rejected', failure: { code: 'stream_projection_changed' } });
    expect(native.frames).toHaveLength(1);
    expect(stream.confirmed[0]!.segments).toEqual([{ type: 'mention', data: { target: 'first-target' } }, { type: 'text', data: { text: 'shown' } }]);
  } finally { operation.release(); await f.close(); }
});

it('keeps legacy outbound middleware on complete delivery and never assumes it is incremental', async () => {
  const native = nativeStreaming(), middleware = vi.fn(async (_context: unknown, next: () => Promise<void>) => next());
  const f = await fixture(async () => 'complete', { streaming: native.streaming,
    middleware: [defineMiddleware({ target: 'outbound', handle: middleware })] });
  const operation = f.im.endpoints.captureOperation({ target: f.target, client: f.index.clientById(f.one.canonicalId) });
  try {
    expect(operation.openReplyStream!()).toBeUndefined();
    expect(middleware).not.toHaveBeenCalled();
    expect(await operation.send('complete reply')).toMatchObject({ status: 'sent' });
    expect(middleware).toHaveBeenCalledTimes(1);
    expect(native.frames).toEqual([]);
  } finally { operation.release(); await f.close(); }
});

it('does not offer a stream or open a native container when the retained source is locally unsupported', async () => {
  const open = vi.fn(), supports = vi.fn(() => false);
  const ordinary = vi.fn(async () => 'complete');
  const f = await fixture(ordinary, { streaming: { mode: 'native', supports, open } });
  const operation = f.im.endpoints.captureOperation({ target: f.target, client: f.index.clientById(f.one.canonicalId) });
  try {
    const source = { messageId: 'trusted-ingress', senderId: 'sender' };
    expect(operation.openReplyStream!({ source })).toBeUndefined();
    expect(supports).toHaveBeenCalledWith({ conversation: f.target, source });
    expect(open).not.toHaveBeenCalled();
    expect(await operation.send('complete reply')).toMatchObject({ status: 'sent' });
    expect(ordinary).toHaveBeenCalledOnce();
  } finally { operation.release(); await f.close(); }
});

it('falls back from an unsupported projected format in the same completed outbound pass', async () => {
  const ordinary = vi.fn(async () => 'complete'), inspect = vi.fn();
  const f = await fixture(ordinary, { streaming: { mode: 'native', open: () => undefined }, middleware: [defineMiddleware({
    target: 'outbound', incremental: true, async handle(_context, next) { inspect(); await next(); },
  })] });
  const operation = f.im.endpoints.captureOperation({ target: f.target, client: f.index.clientById(f.one.canonicalId) });
  try {
    const stream = operation.openReplyStream!()!;
    expect(await stream.finish(streamSnapshot('complete reply', 1, true))).toMatchObject({ status: 'sent' });
    expect(ordinary).toHaveBeenCalledOnce();
    expect(inspect).toHaveBeenCalledOnce();
  } finally { operation.release(); await f.close(); }
});

it('retains real partial facts when admission changes before a queued final update', async () => {
  const native = nativeStreaming(), f = await fixture(async () => 'ordinary', { streaming: native.streaming });
  const operation = f.im.endpoints.captureOperation({ target: f.target, client: f.index.clientById(f.one.canonicalId) });
  let blocked = false;
  try {
    const stream = operation.openReplyStream!({ beforeSubmit() {
      if (blocked) throw new EndpointDeliveryError('reply_blocked', 'Reply admission changed', 'not_sent');
    } })!;
    stream.update(streamSnapshot('already seen', 1));
    await vi.waitFor(() => expect(native.frames).toHaveLength(1));
    blocked = true;
    const result = await stream.finish(streamSnapshot('already seen plus forbidden tail', 2, true));
    expect(result).toMatchObject({ status: 'failed', failure: { code: 'reply_blocked' }, parts: [{ message: { id: 'stream-1' } }] });
    expect(result.failure?.deliveryUnknown).toBeUndefined();
    expect(native.frames).toHaveLength(1);
    expect(stream.confirmed[0]!.segments).toEqual([{ type: 'text', data: { text: 'already seen' } }]);
  } finally { operation.release(); await f.close(); }
});

it('cancels an unabortable in-flight stream without waiting or claiming a known failure', async () => {
  let resolve!: (value: { status: 'sent'; messageId: string; acceptedText: string }) => void;
  const write = vi.fn(() => new Promise<{ status: 'sent'; messageId: string; acceptedText: string }>(done => { resolve = done; }));
  const finish = vi.fn(), cancel = vi.fn();
  const f = await fixture(async () => 'ordinary', { streaming: { mode: 'native', open: () => ({ write, finish, cancel }) } });
  const operation = f.im.endpoints.captureOperation({ target: f.target, client: f.index.clientById(f.one.canonicalId) });
  try {
    const stream = operation.openReplyStream!()!;
    stream.update(streamSnapshot('pending', 1));
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    expect(await stream.cancel()).toMatchObject({ status: 'failed', failure: { code: 'cancelled', deliveryUnknown: true } });
    resolve({ status: 'sent', messageId: 'late', acceptedText: 'pending' });
    expect(await stream.finish(streamSnapshot('pending final', 2, true))).toMatchObject({ status: 'failed', failure: { deliveryUnknown: true } });
    expect(finish).not.toHaveBeenCalled();
    expect(write).toHaveBeenCalledTimes(1);
  } finally { operation.release(); await f.close(); }
});

it('can cancel while final submission is in flight without waiting for an unabortable platform', async () => {
  const finish = vi.fn(() => new Promise<never>(() => {})), cancel = vi.fn();
  const f = await fixture(async () => 'ordinary', { streaming: { mode: 'native', open: () => ({ write: finish, finish, cancel }) } });
  const operation = f.im.endpoints.captureOperation({ target: f.target, client: f.index.clientById(f.one.canonicalId) });
  try {
    const stream = operation.openReplyStream!()!;
    const pending = stream.finish(streamSnapshot('final pending', 1, true));
    await vi.waitFor(() => expect(finish).toHaveBeenCalledTimes(1));
    expect(await stream.cancel()).toMatchObject({ status: 'failed', failure: { code: 'cancelled', deliveryUnknown: true } });
    expect(await pending).toMatchObject({ status: 'failed', failure: { code: 'cancelled', deliveryUnknown: true } });
    expect(stream.confirmed).toEqual([]);
  } finally { operation.release(); await f.close(); }
});

it('keeps text/media/text order and authorizes each atomic resource only once', async () => {
  const native = nativeStreaming(), order: string[] = [];
  const streaming: EndpointStreaming = { ...native.streaming, open(request) {
    const handle = native.streaming.open(request)!;
    return { write: text => { order.push(`text:${text}`); return handle.write(text); },
      finish: text => { order.push(`text:${text}`); return handle.finish(text); }, cancel: () => handle.cancel() };
  } };
  const ordinary = vi.fn(async (_request: EndpointSendRequest) => { order.push('image'); return 'image-message'; });
  const f = await fixture(ordinary, { streaming });
  const operation = f.im.endpoints.captureOperation({ target: f.target, client: f.index.clientById(f.one.canonicalId) });
  const image: Segment = { type: 'image', data: { media: { kind: 'path', value: '/authorized/output.png' } } };
  const snapshot = (revision: number, complete: boolean): ReplyStreamSnapshot => ({ revision, messages: [{ key: 'answer', complete,
    segments: [
      { key: 'first', complete: true, value: { type: 'text', data: { text: 'before' } } },
      { key: 'image', complete: true, value: image },
      { key: 'last', complete, value: { type: 'text', data: { text: complete ? 'after final' : 'after' } } },
    ],
  }] });
  const prepare = vi.fn(async (segments: readonly Segment[]) => segments.map(segment => segment.type === 'image'
    ? { type: 'image', data: { media: { kind: 'url', value: 'https://example.invalid/prepared.png' } } } : segment));
  try {
    const stream = operation.openReplyStream!({ prepare })!;
    stream.update(snapshot(1, false));
    await vi.waitFor(() => expect(ordinary).toHaveBeenCalledTimes(1));
    expect(await stream.finish(snapshot(2, true))).toMatchObject({ status: 'sent', parts: [{}, {}, {}] });
    expect(order[0]).toBe('text:before'); expect(order[1]).toBe('image'); expect(order.at(-1)).toBe('text:after final');
    expect(ordinary).toHaveBeenCalledTimes(1);
    expect(prepare.mock.calls.filter(([segments]) => segments.some(segment => segment.type === 'image'))).toHaveLength(1);
    expect(ordinary.mock.calls[0]![0].payload).toEqual([{ type: 'image', data: { media: { kind: 'url', value: 'https://example.invalid/prepared.png' } } }]);
  } finally { operation.release(); await f.close(); }
});

it.each(['replace', 'remove', 'prepend', 'reorder', 'format', 'address'] as const)(
  'rejects %s of a completed group before sending any later content', async mutation => {
    const native = nativeStreaming(), events = new MemoryConversationEventStore();
    const f = await fixture(async () => 'ordinary', { streaming: native.streaming, events });
    const operation = f.im.endpoints.captureOperation({ target: f.target, client: f.index.clientById(f.one.canonicalId) });
    const message = (key: string, text: string): ReplyStreamSnapshot['messages'][number] => ({ key, complete: true,
      segments: [{ key: 'body', complete: true, value: { type: 'text', data: { text } } }],
    });
    const original = [message('first', 'already shown'), message('second', 'also shown')];
    const changed: ReplyStreamSnapshot['messages'] = mutation === 'replace' ? [message('first', 'replacement'), original[1]!]
      : mutation === 'remove' ? [original[0]!]
      : mutation === 'prepend' ? [message('new', 'must not send'), ...original]
      : mutation === 'reorder' ? [...original].reverse()
      : [{ ...original[0]!, segments: mutation === 'format'
        ? [{ key: 'body', complete: true, value: { type: 'markdown', data: { content: 'already shown' } } }]
        : [{ key: 'mention', complete: true, value: { type: 'mention', data: { target: 'different' } } }, ...original[0]!.segments] }, original[1]!];
    try {
      const stream = operation.openReplyStream!()!;
      stream.update({ revision: 1, messages: original });
      await vi.waitFor(() => expect(native.frames).toHaveLength(2));
      const receipt = await stream.finish({ revision: 2, messages: changed });
      expect(receipt).toMatchObject({ status: 'rejected', failure: { code: 'stream_prefix_changed' }, parts: [{}, {}] });
      expect(native.frames.map(frame => frame.text)).toEqual(['already shown', 'also shown']);
      expect(stream.confirmed.flatMap(part => part.segments)).toEqual(original.flatMap(item => item.segments.map(segment => segment.value)));
      const stored = await events.listMessages!(f.target, undefined, 50);
      expect(stored.map(item => item.message.segments)).toEqual([
        [{ type: 'text', data: { text: 'already shown' } }], [{ type: 'text', data: { text: 'also shown' } }],
      ]);
    } finally { operation.release(); await f.close(); }
  },
);

it.each(['remove', 'prepend', 'format'] as const)('rejects %s of an open published group', async mutation => {
  const native = nativeStreaming();
  const f = await fixture(async () => 'ordinary', { streaming: native.streaming });
  const operation = f.im.endpoints.captureOperation({ target: f.target, client: f.index.clientById(f.one.canonicalId) });
  try {
    const stream = operation.openReplyStream!()!;
    stream.update(streamSnapshot('published prefix', 1));
    await vi.waitFor(() => expect(native.frames).toHaveLength(1));
    const final = streamSnapshot('published prefix final', 2, true);
    const messages: ReplyStreamSnapshot['messages'] = mutation === 'remove' ? []
      : mutation === 'prepend' ? [{ ...final.messages[0]!, key: 'inserted' }, ...final.messages]
      : [{ ...final.messages[0]!, segments: [{ key: 'body', complete: true,
        value: { type: 'image', data: { media: { kind: 'url', value: 'https://example.invalid/replaced.png' } } } }] }];
    expect(await stream.finish({ revision: 2, messages })).toMatchObject({
      status: 'rejected', failure: { code: 'stream_prefix_changed' }, parts: [{}],
    });
    expect(native.frames).toHaveLength(1);
    expect(stream.confirmed[0]!.segments).toEqual([{ type: 'text', data: { text: 'published prefix' } }]);
  } finally { operation.release(); await f.close(); }
});

it('rejects replacement of a completed atomic resource without sending it twice', async () => {
  const native = nativeStreaming(), ordinary = vi.fn(async () => 'image-message');
  const f = await fixture(ordinary, { streaming: native.streaming });
  const operation = f.im.endpoints.captureOperation({ target: f.target, client: f.index.clientById(f.one.canonicalId) });
  const snapshot = (value: string, revision: number): ReplyStreamSnapshot => ({ revision, messages: [{ key: 'answer', complete: true,
    segments: [{ key: 'image', complete: true, value: { type: 'image', data: { media: { kind: 'url', value } } } }],
  }] });
  try {
    const stream = operation.openReplyStream!()!;
    stream.update(snapshot('https://example.invalid/original.png', 1));
    await vi.waitFor(() => expect(ordinary).toHaveBeenCalledTimes(1));
    expect(await stream.finish(snapshot('https://example.invalid/replaced.png', 2))).toMatchObject({
      status: 'rejected', failure: { code: 'stream_prefix_changed' }, parts: [{}],
    });
    expect(ordinary).toHaveBeenCalledTimes(1);
    expect(stream.confirmed[0]!.segments).toEqual(snapshot('https://example.invalid/original.png', 1).messages[0]!.segments.map(segment => segment.value));
  } finally { operation.release(); await f.close(); }
});

it('accepts semantically identical completed groups with different object key order', async () => {
  const native = nativeStreaming();
  const f = await fixture(async () => 'ordinary', { streaming: native.streaming });
  const operation = f.im.endpoints.captureOperation({ target: f.target, client: f.index.clientById(f.one.canonicalId) });
  try {
    const stream = operation.openReplyStream!()!;
    stream.update(streamSnapshot('already shown', 1, true, [{ type: 'image', data: { media: { kind: 'url', value: 'https://example.invalid/original.png' } } }]));
    await vi.waitFor(() => expect(stream.confirmed).toHaveLength(2));
    const reordered = streamSnapshot('already shown', 2, true, [{ data: { media: { value: 'https://example.invalid/original.png', kind: 'url' } }, type: 'image' }]);
    expect(await stream.finish(reordered)).toMatchObject({ status: 'sent', parts: [{}, {}] });
    expect(native.frames).toHaveLength(1);
  } finally { operation.release(); await f.close(); }
});

it('closes capacity-limited containers before continuing and does not repeat mentions', async () => {
  const opened: Array<{ preceding?: string; prefix: readonly Segment[] }> = [], calls: Array<{ kind: string; text: string; id: string }> = [];
  let count = 0;
  const streaming: EndpointStreaming = { mode: 'native', open(request) {
    const id = `container-${++count}`;
    opened.push({ preceding: request.continuation?.precedingText, prefix: request.prefix ?? [] });
    return {
      async write(text) { calls.push({ kind: 'write', text, id }); return { status: 'sent', messageId: id, acceptedText: text.slice(0, 3), ...(text.length >= 3 ? { exhausted: true } : {}) }; },
      async finish(text) { calls.push({ kind: 'finish', text, id }); return { status: 'sent', messageId: id, acceptedText: text.slice(0, 3), ...(text.length > 3 ? { exhausted: true } : {}) }; },
      cancel() {},
    };
  } };
  const f = await fixture(async () => 'ordinary', { streaming });
  const operation = f.im.endpoints.captureOperation({ target: f.target, client: f.index.clientById(f.one.canonicalId) });
  const mention: Segment = { type: 'mention', data: { target: 'user-1' } };
  const snapshot: ReplyStreamSnapshot = { revision: 1, messages: [{ key: 'answer', complete: true, segments: [
    { key: 'mention', complete: true, value: mention }, { key: 'body', complete: true, value: { type: 'text', data: { text: 'abcdefg' } } },
  ] }] };
  try {
    const stream = operation.openReplyStream!()!;
    expect(await stream.finish(snapshot)).toMatchObject({ status: 'sent', parts: [{}, {}, {}] });
    expect(calls.map(call => call.text)).toEqual(['abcdefg', 'defg', 'g']);
    expect(calls.every(call => call.kind === 'finish')).toBe(true);
    expect(opened.map(item => item.preceding)).toEqual([undefined, 'abc', 'abcdef']);
    expect(opened.map(item => item.prefix.length)).toEqual([1, 0, 0]);
    expect(stream.confirmed.flatMap(item => item.segments).filter(segment => segment.type === 'mention')).toEqual([mention]);
  } finally { operation.release(); await f.close(); }
});

it.each([true, false])('stops rather than replaying a confirmed prefix when continuation is unsupported (complete=%s)', async complete => {
  const ordinary = vi.fn(async () => 'ordinary');
  let opens = 0;
  const streaming: EndpointStreaming = { mode: 'native', open() {
    if (opens++) return undefined;
    return {
      async write(text) { return { status: 'sent', messageId: 'partial', acceptedText: text.slice(0, 3), exhausted: true }; },
      async finish(text) { return { status: 'sent', messageId: 'partial', acceptedText: text.slice(0, 3),
        ...(text.length > 3 ? { exhausted: true as const } : {}) }; },
      cancel() {},
    };
  } };
  const f = await fixture(ordinary, { streaming });
  const operation = f.im.endpoints.captureOperation({ target: f.target, client: f.index.clientById(f.one.canonicalId) });
  try {
    const stream = operation.openReplyStream!()!;
    if (!complete) {
      stream.update(streamSnapshot('abcdef', 1));
      await vi.waitFor(() => expect(opens).toBe(2));
    }
    expect(await stream.finish(streamSnapshot('abcdef', 2, true))).toMatchObject({
      status: 'failed', failure: { code: 'stream_continuation_unsupported' }, parts: [{ message: { id: 'partial' } }],
    });
    expect(ordinary).not.toHaveBeenCalled();
    expect(stream.confirmed.map(part => part.segments)).toEqual([[{ type: 'text', data: { text: 'abc' } }]]);
  } finally { operation.release(); await f.close(); }
});

it('persists the latest physically sent revision when a stream is cancelled before completion', async () => {
  const native = nativeStreaming(), events = new MemoryConversationEventStore();
  const f = await fixture(async () => 'ordinary', { streaming: native.streaming, events });
  const operation = f.im.endpoints.captureOperation({ target: f.target, client: f.index.clientById(f.one.canonicalId) });
  try {
    const stream = operation.openReplyStream!()!;
    stream.update(streamSnapshot('first', 1));
    await vi.waitFor(() => expect(native.frames).toHaveLength(1));
    stream.update(streamSnapshot('first second', 2));
    await vi.waitFor(() => expect(stream.confirmed[0]!.segments).toEqual([{ type: 'text', data: { text: 'first second' } }]));
    await stream.cancel();
    const stored = await events.getMessage({ conversation: f.target, id: 'stream-1' });
    expect(stored).toMatchObject({ revision: 2, segments: [{ type: 'text', data: { text: 'first second' } }] });
    expect(await events.listMessages(f.target, undefined, 50)).toHaveLength(1);
  } finally { operation.release(); await f.close(); }
});

it('carries the first rendered reply target into continuation metadata without repeating its prefix', async () => {
  const requests: Array<Parameters<EndpointStreaming['open']>[0]> = [];
  const streaming: EndpointStreaming = { mode: 'native', open(request) {
    requests.push(request);
    return { async write(text) { return { status: 'sent', messageId: `part-${requests.length}`, acceptedText: text }; },
      async finish(text) { return { status: 'sent', messageId: `part-${requests.length}`, acceptedText: text.slice(0, 3),
        ...(text.length > 3 ? { exhausted: true as const } : {}) }; }, cancel() {} };
  } };
  const f = await fixture(async () => 'ordinary', { streaming, middleware: [defineMiddleware<OutboundEnvelope>({
    target: 'outbound', incremental: true, async handle({ input }, next) {
      input.replace([{ type: 'reply', data: { message_id: 'rendered-target' } },
        { type: 'mention', data: { target: 'user' } }, ...input.payload as Segment[]]);
      await next();
    },
  })] });
  const operation = f.im.endpoints.captureOperation({ target: f.target, client: f.index.clientById(f.one.canonicalId) });
  try {
    const stream = operation.openReplyStream!()!;
    expect(await stream.finish(streamSnapshot('abcdefg', 1, true))).toMatchObject({ status: 'sent' });
    expect(requests.map(request => request.continuation)).toEqual([undefined,
      { precedingText: 'abc', replyTo: 'rendered-target' }, { precedingText: 'abcdef', replyTo: 'rendered-target' }]);
    expect(requests.map(request => request.prefix)).toEqual([
      [{ type: 'reply', data: { message_id: 'rendered-target' } }, { type: 'mention', data: { target: 'user' } }], [], [],
    ]);
  } finally { operation.release(); await f.close(); }
});

it.each(['new', 'first', 'stale', 'preview', 'wrong-id', 'invalid-prefix'] as const)(
  'retains verified final content through a close error only for a new saved acknowledgement (%s)', async mode => {
    type Acknowledgement = Awaited<ReturnType<NonNullable<ReturnType<EndpointStreaming['open']>>['write']>>;
    let cached: Acknowledgement | undefined;
    const write = vi.fn(async (text: string): Promise<Acknowledgement> => {
      cached = { status: 'sent', messageId: 'physical', acceptedText: text }; return cached;
    });
    const finish = vi.fn(async (text: string): Promise<Acknowledgement> => {
      if (mode !== 'stale') cached = { status: mode === 'preview' ? 'preview' : 'sent',
        messageId: mode === 'wrong-id' ? 'different' : 'physical', acceptedText: mode === 'invalid-prefix' ? 'rewritten' : text };
      throw new EndpointDeliveryError('close_failed', 'Synthetic close failed after its body update', 'unknown');
    });
    const streaming: EndpointStreaming = { mode: 'native', open() { return {
      write, finish, get lastAcknowledgement() { return cached; }, cancel() {},
    }; } };
    const events = new MemoryConversationEventStore(), ordinary = vi.fn(async () => 'ordinary');
    const f = await fixture(ordinary, { streaming, events });
    const operation = f.im.endpoints.captureOperation({ target: f.target, client: f.index.clientById(f.one.canonicalId) });
    try {
      const stream = operation.openReplyStream!()!;
      if (mode !== 'first') {
        stream.update(streamSnapshot('old', 1));
        await vi.waitFor(() => expect(stream.confirmed).toHaveLength(1));
      }
      expect(await stream.finish(streamSnapshot('old final', 2, true))).toMatchObject({
        status: 'failed', failure: { code: 'close_failed', deliveryUnknown: true }, parts: [{ message: { id: 'physical' } }],
      });
      const expected = mode === 'new' || mode === 'first' ? 'old final' : 'old';
      expect((await events.getMessage({ conversation: f.target, id: 'physical' }))!.segments).toEqual([{ type: 'text', data: { text: expected } }]);
      expect(stream.confirmed[0]!.segments).toEqual([{ type: 'text', data: { text: expected } }]);
      expect(write).toHaveBeenCalledTimes(mode === 'first' ? 0 : 1);
      expect(finish).toHaveBeenCalledTimes(1);
      expect(ordinary).not.toHaveBeenCalled();
    } finally { operation.release(); await f.close(); }
  },
);

it('records a saved capacity-limited preview after close fails without opening another container', async () => {
  type Acknowledgement = Awaited<ReturnType<NonNullable<ReturnType<EndpointStreaming['open']>>['write']>>;
  let cached: Acknowledgement | undefined;
  const write = vi.fn(async (text: string): Promise<Acknowledgement> => ({ status: 'preview', acceptedText: text.slice(0, 3), exhausted: true }));
  const finish = vi.fn(async (text: string): Promise<Acknowledgement> => {
    cached = { status: 'sent', messageId: 'saved-preview', acceptedText: text };
    throw new EndpointDeliveryError('close_failed', 'Synthetic close failed', 'unknown');
  });
  const open = vi.fn(() => ({ write, finish, get lastAcknowledgement() { return cached; }, cancel() {} }));
  const events = new MemoryConversationEventStore(), f = await fixture(async () => 'ordinary', { streaming: { mode: 'draft', open }, events });
  const operation = f.im.endpoints.captureOperation({ target: f.target, client: f.index.clientById(f.one.canonicalId) });
  try {
    const stream = operation.openReplyStream!()!;
    stream.update(streamSnapshot('abcdef', 1));
    await vi.waitFor(() => expect(stream.receipt.failure?.code).toBe('close_failed'));
    expect(await stream.finish(streamSnapshot('abcdef', 2, true))).toMatchObject({
      status: 'failed', failure: { code: 'close_failed', deliveryUnknown: true }, parts: [{ message: { id: 'saved-preview' } }],
    });
    expect((await events.getMessage({ conversation: f.target, id: 'saved-preview' }))!.segments).toEqual([{ type: 'text', data: { text: 'abc' } }]);
    expect(open).toHaveBeenCalledOnce(); expect(write).toHaveBeenCalledOnce(); expect(finish).toHaveBeenCalledExactlyOnceWith('abc');
  } finally { operation.release(); await f.close(); }
});

it('keeps a known text and keyboard message atomic through the real renderer and native endpoint', async () => {
  const native = nativeStreaming(), ordinary = vi.fn(async () => 'interactive-message');
  const f = await fixture(ordinary, { streaming: native.streaming, nativeKeyboard: true });
  const operation = f.im.endpoints.captureOperation({ target: f.target, client: f.index.clientById(f.one.canonicalId) });
  const keyboard: Segment = { type: 'keyboard', data: { rows: [[{ id: 'confirm', label: 'Confirm', payload: 'confirmed' }]] } };
  try {
    const stream = operation.openReplyStream!()!;
    stream.update(streamSnapshot('Choose', 1, false, [keyboard]));
    await new Promise(resolve => setImmediate(resolve));
    expect(native.frames).toEqual([]); expect(ordinary).not.toHaveBeenCalled();
    expect(await stream.finish(streamSnapshot('Choose', 2, true, [keyboard]))).toMatchObject({ status: 'sent' });
    expect(native.frames).toEqual([]);
    expect(ordinary).toHaveBeenCalledOnce();
    expect(ordinary.mock.calls[0]![0].payload).toEqual([{ type: 'text', data: { text: 'Choose' } }, keyboard]);
    expect(stream.confirmed[0]!.message).toMatchObject({ id: 'interactive-message' });
  } finally { operation.release(); await f.close(); }
});

it('stops without sending a keyboard that arrives after its text was published', async () => {
  const native = nativeStreaming(), ordinary = vi.fn(async () => 'interactive-message');
  const f = await fixture(ordinary, { streaming: native.streaming, nativeKeyboard: true });
  const operation = f.im.endpoints.captureOperation({ target: f.target, client: f.index.clientById(f.one.canonicalId) });
  const keyboard: Segment = { type: 'keyboard', data: { rows: [[{ id: 'confirm', label: 'Confirm', payload: 'confirmed' }]] } };
  try {
    const stream = operation.openReplyStream!()!;
    stream.update(streamSnapshot('Choose', 1));
    await vi.waitFor(() => expect(native.frames).toHaveLength(1));
    expect(await stream.finish(streamSnapshot('Choose', 2, true, [keyboard]))).toMatchObject({
      status: 'rejected', failure: { code: 'stream_prefix_changed' }, parts: [{ message: { id: 'stream-1' } }],
    });
    expect(native.frames).toHaveLength(1); expect(ordinary).not.toHaveBeenCalled();
    expect(stream.confirmed[0]!.segments).toEqual([{ type: 'text', data: { text: 'Choose' } }]);
  } finally { operation.release(); await f.close(); }
});

it('does not let a terminal history failure turn a confirmed stream into a delivery failure', async () => {
  class FailingUpdates extends MemoryConversationEventStore {
    override append(event: Parameters<MemoryConversationEventStore['append']>[0]) {
      if (event.type === 'message.updated') return Promise.reject(new Error('synthetic storage unavailable'));
      return super.append(event);
    }
  }
  const native = nativeStreaming(), f = await fixture(async () => 'ordinary', { streaming: native.streaming, events: new FailingUpdates() });
  const operation = f.im.endpoints.captureOperation({ target: f.target, client: f.index.clientById(f.one.canonicalId) });
  try {
    const stream = operation.openReplyStream!()!;
    stream.update(streamSnapshot('first', 1));
    await vi.waitFor(() => expect(native.frames).toHaveLength(1));
    expect(await stream.finish(streamSnapshot('first final', 2, true))).toMatchObject({ status: 'sent' });
    expect(native.frames).toHaveLength(2);
    expect(stream.confirmed[0]!.segments).toEqual([{ type: 'text', data: { text: 'first final' } }]);
  } finally { operation.release(); await f.close(); }
});

it('does not fabricate standalone rich-text history when the platform cannot confirm it', async () => {
  const events = new MemoryConversationEventStore();
  const f = await fixture(async () => 'ordinary', { events, streaming: { mode: 'native', open: () => ({
    async write(text) { return { status: 'sent', messageId: 'rich', acceptedText: text, contentUnavailable: true }; },
    async finish(text) { return { status: 'sent', messageId: 'rich', acceptedText: text, contentUnavailable: true }; }, cancel() {},
  }) } });
  const operation = f.im.endpoints.captureOperation({ target: f.target, client: f.index.clientById(f.one.canonicalId) });
  try {
    const stream = operation.openReplyStream!()!;
    const snapshot: ReplyStreamSnapshot = { revision: 1, messages: [{ key: 'answer', complete: true, segments: [
      { key: 'body', complete: true, value: { type: 'markdown', data: { content: 'partial code without its surrounding fence' } } },
    ] }] };
    expect(await stream.finish(snapshot)).toMatchObject({ status: 'sent', message: { id: 'rich' } });
    expect(stream.confirmed).toMatchObject([{ message: { id: 'rich' }, segments: [] }]);
    expect(await events.getMessage({ conversation: f.target, id: 'rich' })).toMatchObject({ contentStatus: 'unavailable' });
    expect((await events.getMessage({ conversation: f.target, id: 'rich' }))?.content).toBeUndefined();
  } finally { operation.release(); await f.close(); }
});

it.each([
  { incremental: false, canonical: false }, { incremental: true, canonical: false },
  { incremental: false, canonical: true }, { incremental: true, canonical: true },
  { incremental: false, canonical: 'markdown' as const }, { incremental: true, canonical: 'markdown' as const },
  { incremental: false, canonical: 'markdown-platform' as const }, { incremental: true, canonical: 'markdown-extra-data' as const },
])('records cross-container Markdown only from independently confirmed physical content: %j', async ({ incremental, canonical }) => {
  const events = new MemoryConversationEventStore(), bodies = new Map<string, readonly Segment[]>();
  let opened = 0;
  const f = await fixture(async () => 'ordinary', { events, nativeMarkdown: true, streaming: { mode: 'native', open: request => {
    expect(request.format).toBe('markdown');
    const messageId = `rich-container-${++opened}`;
    const submit = async (text: string, finish: boolean) => {
      const acceptedText = text.slice(0, 8);
      const body: readonly Segment[] = typeof canonical === 'string'
        ? [{ type: 'markdown', data: { content: `**visible:${acceptedText}**`, ...(canonical === 'markdown-extra-data' ? { hidden: 'not confirmed authoring content' } : {}) },
          ...(canonical === 'markdown-platform' ? { platform: { hidden: 'native field' } } : {}) }]
        : [{ type: 'text', data: { text: `visible:${acceptedText}` } }];
      bodies.set(messageId, body);
      return { status: 'sent' as const, messageId, acceptedText,
        ...(text.length > 8 || !finish && text.length === 8 ? { exhausted: true as const } : {}),
        ...(canonical ? { confirmedContent: body } : {}),
      };
    };
    return { write: text => submit(text, false), finish: text => submit(text, true), cancel() {} };
  } } });
  const operation = f.im.endpoints.captureOperation({ target: f.target, client: f.index.clientById(f.one.canonicalId) });
  const snapshot = (revision: number, complete: boolean): ReplyStreamSnapshot => ({ revision, messages: [{ key: 'answer', complete, segments: [
    { key: 'body', complete, value: { type: 'markdown', data: { content: '```ts\nconst n=1;\n```' } } },
  ] }] });
  try {
    const stream = operation.openReplyStream!()!;
    if (incremental) {
      stream.update(snapshot(1, false));
      await vi.waitFor(() => expect(opened).toBe(3));
    }
    expect(await stream.finish(snapshot(2, true))).toMatchObject({ status: 'sent' });
    expect(stream.confirmed).toHaveLength(3);
    for (const physical of stream.confirmed) {
      const stored = await events.getMessage(physical.message!);
      if (canonical === true || canonical === 'markdown') {
        expect(physical.segments).toEqual(bodies.get(physical.message!.id));
        expect(stored?.segments).toEqual(bodies.get(physical.message!.id));
        expect(stored?.contentStatus).toBeUndefined();
      } else {
        expect(physical.segments).toEqual([]);
        expect(stored).toMatchObject({ contentStatus: 'unavailable', segments: [] });
      }
    }
  } finally { operation.release(); await f.close(); }
});

it('does not open an empty container when the final source ends exactly at a previous capacity boundary', async () => {
  const opened = vi.fn(() => ({
    async write(text: string) { return { status: 'sent' as const, messageId: 'full', acceptedText: text, exhausted: true as const }; },
    async finish(text: string) { return { status: 'sent' as const, messageId: 'full', acceptedText: text }; }, cancel() {},
  }));
  const f = await fixture(async () => 'ordinary', { streaming: { mode: 'native', open: opened } });
  const operation = f.im.endpoints.captureOperation({ target: f.target, client: f.index.clientById(f.one.canonicalId) });
  try {
    const stream = operation.openReplyStream!()!;
    stream.update(streamSnapshot('abc', 1));
    await vi.waitFor(() => expect(stream.confirmed[0]?.segments).toEqual([{ type: 'text', data: { text: 'abc' } }]));
    expect(await stream.finish(streamSnapshot('abc', 2, true))).toMatchObject({ status: 'sent', parts: [{}] });
    expect(opened).toHaveBeenCalledTimes(1);
  } finally { operation.release(); await f.close(); }
});

it('creates formal history when a capacity-limited preview is first saved by completion', async () => {
  const events = new MemoryConversationEventStore();
  const f = await fixture(async () => 'ordinary', { events, streaming: { mode: 'draft', open: () => ({
    async write(text) { return { status: 'preview', acceptedText: text, exhausted: true }; },
    async finish(text) { return { status: 'sent', messageId: 'saved-preview', acceptedText: text }; }, cancel() {},
  }) } });
  const operation = f.im.endpoints.captureOperation({ target: f.target, client: f.index.clientById(f.one.canonicalId) });
  try {
    const stream = operation.openReplyStream!()!;
    stream.update(streamSnapshot('preview body', 1));
    await vi.waitFor(async () => expect(await events.getMessage({ conversation: f.target, id: 'saved-preview' }))
      .toMatchObject({ segments: [{ type: 'text', data: { text: 'preview body' } }] }));
    expect(await stream.finish(streamSnapshot('preview body', 2, true))).toMatchObject({ status: 'sent' });
  } finally { operation.release(); await f.close(); }
});

it('continues all transformed source after a nonterminal capacity acknowledgement', async () => {
  const frames: string[] = [];
  let count = 0;
  const f = await fixture(async () => 'ordinary', { streaming: { mode: 'native', open: () => {
    const messageId = `part-${++count}`;
    return { async write(text) { frames.push(text); return { status: 'sent', messageId, acceptedText: text.slice(0, 3), ...(text.length >= 3 ? { exhausted: true } : {}) }; },
      async finish(text) { return { status: 'sent', messageId, acceptedText: text.slice(0, 3), ...(text.length > 3 ? { exhausted: true } : {}) }; }, cancel() {} };
  } }, middleware: [defineMiddleware<OutboundEnvelope>({ target: 'outbound', incremental: true,
    async handle({ input }, next) { input.replace(`prefix:${String((input.payload as Segment[])[0]!.data.text)}`); await next(); },
  })] });
  const operation = f.im.endpoints.captureOperation({ target: f.target, client: f.index.clientById(f.one.canonicalId) });
  try {
    const stream = operation.openReplyStream!()!;
    stream.update(streamSnapshot('x', 1));
    await vi.waitFor(() => expect(frames).toEqual(['prefix:x', 'fix:x', ':x']));
    expect(await stream.finish(streamSnapshot('x', 2, true))).toMatchObject({ status: 'sent', parts: [{}, {}, {}] });
    expect(stream.confirmed.flatMap(part => part.segments).map(segment => segment.data.text).join('')).toBe('prefix:x');
  } finally { operation.release(); await f.close(); }
});

it('preserves cancellation evidence even if an adapter local teardown throws', async () => {
  const native = nativeStreaming();
  const f = await fixture(async () => 'ordinary', { streaming: { ...native.streaming, open(request) {
    const handle = native.streaming.open(request)!;
    return { ...handle, cancel() { throw new Error('synthetic local teardown failure'); } };
  } } });
  const operation = f.im.endpoints.captureOperation({ target: f.target, client: f.index.clientById(f.one.canonicalId) });
  try {
    const stream = operation.openReplyStream!()!;
    stream.update(streamSnapshot('visible', 1));
    await vi.waitFor(() => expect(native.frames).toHaveLength(1));
    expect(await stream.cancel()).toMatchObject({ status: 'failed', failure: { code: 'cancelled' }, parts: [{ message: { id: 'stream-1' } }] });
  } finally { operation.release(); await f.close(); }
});

it('drains an admitted stream after the capture stops accepting new operations', async () => {
  const native = nativeStreaming(), f = await fixture(async () => 'ordinary', { streaming: native.streaming });
  const operation = f.im.endpoints.captureOperation({ target: f.target, client: f.index.clientById(f.one.canonicalId) });
  try {
    const stream = operation.openReplyStream!()!;
    operation.release();
    expect(() => operation.openReplyStream!()).toThrow();
    expect(await stream.finish(streamSnapshot('already admitted', 1, true))).toMatchObject({ status: 'sent' });
    expect(native.frames.map(frame => frame.text)).toEqual(['already admitted']);
  } finally { operation.release(); await f.close(); }
});

it('rejects an oversized semantic snapshot at admission and preserves only confirmed content', async () => {
  const native = nativeStreaming(), f = await fixture(async () => 'ordinary', { streaming: native.streaming });
  const operation = f.im.endpoints.captureOperation({ target: f.target, client: f.index.clientById(f.one.canonicalId) });
  try {
    const stream = operation.openReplyStream!()!;
    stream.update(streamSnapshot('visible prefix', 1));
    await vi.waitFor(() => expect(native.frames).toHaveLength(1));
    stream.update(streamSnapshot('visible prefix' + 'x'.repeat(1024 * 1024), 2));
    expect(stream.receipt).toMatchObject({ status: 'failed', failure: { code: 'stream_buffer_limit', retryable: false } });
    expect(await stream.finish(streamSnapshot('new attempt', 3, true))).toMatchObject({ status: 'failed', failure: { code: 'stream_buffer_limit' } });
    expect(native.frames.map(frame => frame.text)).toEqual(['visible prefix']);
    expect(stream.confirmed[0]!.segments).toEqual([{ type: 'text', data: { text: 'visible prefix' } }]);
  } finally { operation.release(); await f.close(); }
});

it('excludes inline media bytes from the semantic bound and still authorizes the atomic media', async () => {
  const native = nativeStreaming(), ordinary = vi.fn(async () => 'image');
  const f = await fixture(ordinary, { streaming: native.streaming });
  const operation = f.im.endpoints.captureOperation({ target: f.target, client: f.index.clientById(f.one.canonicalId) });
  const image: Segment = { type: 'image', data: { media: { kind: 'base64', value: 'a'.repeat(2 * 1024 * 1024) } } };
  const prepared: Segment = { type: 'image', data: { media: { kind: 'url', value: 'https://example.invalid/authorized.png' } } };
  const prepare = vi.fn(async () => [prepared]);
  try {
    const stream = operation.openReplyStream!({ prepare })!;
    expect(await stream.finish({ revision: 1, messages: [{ key: 'answer', complete: true, segments: [{ key: 'image', complete: true, value: image }] }] }))
      .toMatchObject({ status: 'sent' });
    expect(prepare).toHaveBeenCalledOnce();
    expect(ordinary.mock.calls[0]![0].payload).toEqual([prepared]);
  } finally { operation.release(); await f.close(); }
});

it('holds untrusted streamed media to the media policy after prepare (no host files reach the Endpoint)', async () => {
  const native = nativeStreaming(), ordinary = vi.fn(async () => 'image');
  const seen: unknown[] = [];
  const f = await fixture(ordinary, { streaming: native.streaming, middleware: [defineMiddleware({
    target: 'outbound', incremental: true, async handle(envelope: OutboundEnvelope, next) { seen.push(envelope.payload); await next(); },
  })] });
  const operation = f.im.endpoints.captureOperation({ target: f.target, client: f.index.clientById(f.one.canonicalId) });
  const hostFile: Segment = { type: 'image', data: { media: { kind: 'file', value: 'file:///etc/passwd' } } };
  try {
    const stream = operation.openReplyStream!({ prepare: async segments => segments, mediaTrust: { source: 'test:model' } })!;
    expect(await stream.finish({ revision: 1, messages: [{ key: 'answer', complete: true, segments: [{ key: 'image', complete: true, value: hostFile }] }] }))
      .toMatchObject({ status: 'sent' });
    const payload = ordinary.mock.calls[0]![0].payload as Segment[];
    expect(payload).toEqual([{ type: 'text', data: { text: '[图片未发送：媒体来源不被允许]' } }]);
    expect(seen.length).toBeGreaterThan(0);
    expect(JSON.stringify(seen)).not.toContain('passwd');
  } finally { operation.release(); await f.close(); }
});

it('routes existing-message control solely by its canonical reference, not contradictory selectors', async () => {
  const f = await fixture();
  try {
    const input = { adapter: 'test', endpointKey: 'two', message: { conversation: f.target, id: 'one-message' } };
    await f.im.endpoints.recall(input);
    expect(f.calls).toEqual([{ account: 'one', message: 'one-message' }]);
    await expect(f.im.endpoints.recall({ message: { ...input.message,
      conversation: { ...f.target, endpoint: { ...f.target.endpoint, adapter: 'foreign' } } } })).rejects.toMatchObject({ code: 'endpoint_identity_mismatch' });
    expect(f.calls).toHaveLength(1);
  } finally { await f.close(); }
});

it('captures the same account for profile reads and writes without sharing another account cache', async () => {
  const f = await fixture();
  const caller = new AbortController();
  const source = f.im.endpoints.captureOperation({
    target: f.target, client: f.index.clientById(f.one.canonicalId), signal: caller.signal,
  });
  const other = f.im.endpoints.captureOperation({
    target: { ...f.target, endpoint: { ...f.target.endpoint, id: f.two.canonicalId } },
    client: f.index.clientById(f.two.canonicalId),
  });
  try {
    expect(await source.profile!.read({ signal: caller.signal })).toMatchObject({ values: { nickname: 'one' } });
    await source.profile!.write!({ signal: caller.signal, change: { field: 'nickname', value: 'Changed' } });
    expect(source.profile!.peek()).toMatchObject({ values: { nickname: 'Changed' }, sources: { nickname: 'platform' } });
    expect(await other.profile!.read({ signal: new AbortController().signal })).toMatchObject({ values: { nickname: 'two' } });
    source.release();
    await expect(source.profile!.write!({ signal: caller.signal, change: { field: 'nickname', value: 'Escaped' } }))
      .rejects.toMatchObject({ code: 'operation_scope_ended' });
  } finally { source.release(); other.release(); await f.close(); }
});

it('retains full scene and actual source Client, and releases on account cancellation without rebinding', async () => {
  const f = await fixture();
  const source = f.index.clientById(f.one.canonicalId);
  const operation = f.im.endpoints.captureOperation({ target: f.target, client: source });
  try {
    expect(operation.target).toEqual(f.target);
    await operation.control!.recall!({ message: { conversation: f.target, id: 'early' } });
    const stopping = f.adapter.stop(f.one.instanceId, f.adapter.revision);
    await vi.waitFor(() => expect(operation.signal.aborted).toBe(true));
    operation.release(); operation.release();
    await stopping;
    await f.adapter.start(f.one.instanceId, f.adapter.revision);
    await expect(operation.control!.recall!({ message: { conversation: f.target, id: 'late' } })).rejects.toMatchObject({ disposition: 'not_sent' });
    await expect(operation.send('late')).rejects.toMatchObject({ disposition: 'not_sent' });
    await expect(operation.profile!.read({ signal: new AbortController().signal, refresh: true }))
      .rejects.toMatchObject({ disposition: 'not_sent' });
    expect(f.calls).toEqual([{ account: 'one', message: 'early' }]);
  } finally { operation.release(); await f.close(); }
});

it('rejects a foreign source Client and preserves usability of the correct account', async () => {
  const f = await fixture();
  try {
    expect(() => f.im.endpoints.captureOperation({ target: f.target, client: f.index.clientById(f.two.canonicalId) }))
      .toThrow();
    const operation = f.im.endpoints.captureOperation({ target: f.target, client: f.index.clientById(f.one.canonicalId) });
    try {
      const other: MessageRef = { conversation: { ...f.target, endpoint: { id: f.two.canonicalId, adapter: 'test' } }, id: 'other' };
      await expect(operation.control!.recall!({ message: other })).rejects.toMatchObject({ code: 'endpoint_identity_mismatch' });
      await operation.control!.recall!({ message: { conversation: f.target, id: 'correct' } });
    } finally { operation.release(); }
    expect(f.calls).toEqual([{ account: 'one', message: 'correct' }]);
  } finally { await f.close(); }
});

it('cancels one captured send without cancelling its retained source or a sibling send', async () => {
  const submissions: AbortSignal[] = [];
  const f = await fixture(async ({ signal }) => {
    submissions.push(signal!);
    if (submissions.length > 1) return 'sibling';
    return new Promise<string>((_resolve, reject) => signal!.addEventListener('abort', () => reject(signal!.reason), { once: true }));
  });
  const operation = f.im.endpoints.captureOperation({ target: f.target, client: f.index.clientById(f.one.canonicalId) });
  try {
    const caller = new AbortController();
    const pending = operation.send('pending', { signal: caller.signal });
    const failed = expect(pending).resolves.toMatchObject({ status: 'failed', failure: { deliveryUnknown: true } });
    await vi.waitFor(() => expect(submissions).toHaveLength(1));
    caller.abort(new Error('caller stopped'));
    expect(submissions[0]!.aborted).toBe(true);
    await failed;
    expect(operation.signal.aborted).toBe(false);
    await expect(operation.send('sibling')).resolves.toMatchObject({ status: 'sent' });
    expect(submissions[1]!.aborted).toBe(false);
  } finally { operation.release(); await f.close(); }
});


it('keeps a captured operation alive across replacement, but cancels it on explicit Root stop', async () => {
  const f = await fixture();
  const operation = f.im.endpoints.captureOperation({ target: f.target, client: f.index.clientById(f.one.canonicalId) });
  try {
    f.store.commit(0, { snapshot: { ...f.state, projections: new Map([[adapterFeatureId, f.index]]) }, dispose() {} });
    expect(operation.signal.aborted).toBe(false);
    await operation.control!.recall!({ message: { conversation: f.target, id: 'after-replacement' } });
    expect(f.calls).toEqual([{ account: 'one', message: 'after-replacement' }]);
    const closing = f.store.close();
    expect(operation.signal.aborted).toBe(true);
    operation.release();
    await closing;
  } finally { operation.release(); await f.close(); }
});


it('owns an independent snapshot lease when capture outlives its parent snapshot view', async () => {
  const f = await fixture();
  let operation!: ReturnType<typeof f.im.endpoints.captureOperation>;
  let disposed = false;
  f.store.commit(0, { snapshot: { ...f.state, projections: new Map([[adapterFeatureId, f.index]]) }, dispose: () => { disposed = true; } });
  try {
    await f.im.runWithSnapshotView(async () => {
      operation = f.im.endpoints.captureOperation({ target: f.target, client: f.index.clientById(f.one.canonicalId) });
    });
    f.store.commit(1, { snapshot: { ...f.state, projections: new Map([[adapterFeatureId, f.index]]) }, dispose() {} });
    expect(disposed).toBe(false);
    await expect(operation.send('after-parent-finished')).resolves.toMatchObject({ status: 'sent' });
    operation.release();
    await vi.waitFor(() => expect(disposed).toBe(true));
  } finally { operation?.release(); await f.close(); }
});
