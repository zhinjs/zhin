import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Adapter, AdapterIndex, adapterFeatureId, createEndpointSpecification, defineAdapter, endpointEventGatewayToken, endpointSpec,
  type EndpointSpecification, type EndpointChildLease, type EndpointDesiredRepository, type EndpointDesiredSnapshot, type PlatformEndpoint } from 'zhin.js/adapter';
import { ImRuntime, type Message } from '@zhin.js/core/runtime';
import { PluginStateStore, SnapshotStore, createCapabilitySlot, createSnapshotView, rootPluginId, type SnapshotState, type StateRecord } from 'zhin.js/plugin-runtime';
import { MiddlewareIndex, middlewareFeatureId, defineMiddleware } from '../../../../packages/im/middleware/src/index.js';
import { HandlerIndex, handlerFeatureId, defineHandler } from '../../../../packages/im/handler/src/index.js';
import { aiCompletionToken, databaseHostToken, outboundHostToken, type AiCompletionInput } from 'zhin.js';
import inbound from '../middlewares/inbound/index.ts';
import { ModerationEngine } from '../src/engine.js';
import { moderationEngineToken } from '../src/runtime.js';
import { createOutboundHost } from '../../../../basic/cli/src/plugin-runtime/outbound-host-installer.js';
import type { CapturedOutboundOperation, OutboundCaptureInput, Locale } from 'zhin.js/plugin-runtime';

const NOW = Date.UTC(2026, 9, 23, 12);
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function result(input: AiCompletionInput) {
  const messages = JSON.parse(input.untrusted![0]!.text).messages as { id: string; batchId: string; text: string }[];
  return { model: 'fixture', durationMs: 0, text: JSON.stringify({ reviews: messages.map(item => ({
    id: item.id, batchId: item.batchId, category: 'advertising', evidence: [item.text], recall: false, recallReason: 'retain context',
  })) }) };
}
class ReviewEndpoint implements PlatformEndpoint {
  readonly sent = vi.fn(async () => 'notice');
  readonly inspect = vi.fn(async (_group: string, _member: string, _signal: AbortSignal) => ({ canModerate: true, joinedAt: NOW - 3600_000 }));
  readonly stopped = vi.fn();
  readonly [endpointSpec]: EndpointSpecification;
  constructor(account: string) {
    this[endpointSpec] = createEndpointSpecification(this, { name: account,
      start() {}, open() {}, close() {}, stop: () => { this.stopped(); }, send: () => this.sent(),
      management: { inspectGroupMember: ({ groupId, userId, signal }) => this.inspect(groupId, userId, signal) },
    });
    this[endpointSpec].reportSelfUserId(account);
  }
}
class ReviewAdapter extends Adapter<ReviewEndpoint> {
  protected createEndpoint(config: Readonly<Record<string, unknown>>) { return new ReviewEndpoint(String(config.id)); }
}
const cleanups: Array<() => Promise<void>> = [];
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
afterEach(async () => { for (const close of cleanups.splice(0)) await close(); vi.useRealTimers(); });
async function fixture(options: { hold?: 'handler' | 'middleware' } = {}) {
  const root = rootPluginId(), adapter = new ReviewAdapter(), im = new ImRuntime();
  const config = { endpoints: [{ id: '10001' }, { id: '10002' }],
    groupModeration: ['10001', '10002'].map(account => ({ adapter: 'icqq', endpoint: account, account, group: 'room' })),
    sources: [{ id: 'fixture', type: 'local', includeBuiltin: false, words: [] }] };
  const engine = new ModerationEngine(); engine.configure(config);
  const completeText = vi.fn(async (input: AiCompletionInput) => result(input));
  const sendTarget = vi.fn(async (operation: CapturedOutboundOperation, content: unknown, options?: { locale?: Locale; signal?: AbortSignal }) => operation.send(content, options));
  const rootOutbound = createOutboundHost(im);
  const recall = vi.fn(async () => undefined);
  const captureOperation = (input: OutboundCaptureInput) => {
    if (!rootOutbound.captureOperation) throw new Error('Fixture requires real Core capture');
    const operation = rootOutbound.captureOperation(input, root);
    return { ...operation, send: (content: unknown, options?: { locale?: Locale; signal?: AbortSignal }) => sendTarget(operation, content, options) };
  };
  const rows = new Map<string, StateRecord>(); let revision = 0;
  const state = new PluginStateStore(root, {
    read: async (_owner, scope, key) => rows.get(JSON.stringify([scope, key])),
    compareExchange: async (_owner, scope, key, expected, value, expiresAt) => {
      const identity = JSON.stringify([scope, key]); if (rows.get(identity)?.revision !== expected) return false;
      if (value === undefined) rows.delete(identity); else rows.set(identity, { revision: String(++revision), value, expiresAt });
      return true;
    },
  });
  const held = deferred(), resume = deferred();
  const signals: Partial<Record<'handler' | 'middleware', { context: AbortSignal; session: AbortSignal }>> = {};
  const middleware = createCapabilitySlot({ owner: root, feature: middlewareFeatureId, localName: 'capture', source: '/fixture/capture.ts',
    definition: defineMiddleware<Message>({ order: -200, async handle(context, next) {
      signals.middleware = { context: context.signal, session: context.session!.signal };
      if (options.hold === 'middleware') { held.resolve(); await resume.promise; if (context.session!.signal.aborted) return; }
      await next();
    } }) });
  const moderation = createCapabilitySlot({ owner: root, feature: middlewareFeatureId, localName: 'moderation', source: '/fixture/moderation.ts', definition: inbound });
  const handler = createCapabilitySlot({ owner: root, feature: handlerFeatureId, localName: 'capture', source: '/fixture/handler.ts',
    definition: defineHandler({ event: 'message.receive', async handle() {
      signals.handler = { context: this.signal, session: this.session!.signal };
      if (options.hold === 'handler') { held.resolve(); await resume.promise; }
    } }) });
  const slot = createCapabilitySlot({ owner: root, feature: adapterFeatureId, localName: 'icqq', source: '/fixture/adapter.ts',
    definition: defineAdapter({ capabilities: ['inbound', 'outbound'], createAdapter: () => adapter }) });
  const slots = [slot, middleware, moderation, handler];
  const base: SnapshotState = { root,
    tree: new Map([[root, { id: root, instanceKey: 'root', packageName: 'fixture', packageRoot: '/fixture', children: [] }]]),
    config: new Map([[root, config]]),
    resources: new Map([[root, new Map<string, unknown>([[endpointEventGatewayToken.id, im.endpointEvents], [moderationEngineToken.id, engine],
      [aiCompletionToken.id, { supportsUsageShares: true, completeText }], [databaseHostToken.id, { state: { forConversation: () => state } }],
      [outboundHostToken.id, { captureOperation, recall }]])]]), capabilities: new Map(slots.map(slot => [slot.id, slot])), projections: new Map() };
  let saved: EndpointDesiredSnapshot | undefined;
  const repository: EndpointDesiredRepository = { load: async () => saved, compareAndSet: async (_id, expected, endpoints) => {
    if ((saved?.revision ?? null) !== expected) throw new Error('conflict'); return saved = structuredClone({ revision: (expected ?? 0) + 1, endpoints });
  } };
  const view = createSnapshotView(0, base);
  const index = await AdapterIndex.create([slot], view, new AbortController().signal, { repository });
  const leases: Array<{ lease: EndpointChildLease; released: boolean }> = [];
  const acquire = index.acquire.bind(index);
  vi.spyOn(index, 'acquire').mockImplementation((...args) => {
    const lease = acquire(...args), tracked = { lease, released: false }; leases.push(tracked);
    return Object.freeze({ ...lease, release: () => { tracked.released = true; lease.release(); } });
  });
  const store = new SnapshotStore({ ...base, projections: new Map<string, unknown>([[adapterFeatureId, index],
    [middlewareFeatureId, new MiddlewareIndex([middleware, moderation], view)], [handlerFeatureId, new HandlerIndex([handler], view)]]) as SnapshotState['projections'] });
  im.attach(store); await index.start(); index.open();
  const accounts = adapter.list(), one = adapter.getEndpoint(accounts[0]!.instanceId)!, two = adapter.getEndpoint(accounts[1]!.instanceId)!;
  const enqueue = vi.spyOn(engine.groupReviewQueue, 'enqueue');
  let sequence = 0;
  const receive = (endpoint: ReviewEndpoint, sender = endpoint === one ? 'alice' : 'bob', text = '联系我购买这个产品') => endpoint[endpointSpec].events.message({
    conversation: { endpoint: { id: 'normalizer-input', adapter: 'icqq' }, kind: 'group', id: 'room' }, sender: { id: sender },
    content: text, message: { conversation: { endpoint: { id: 'normalizer-input', adapter: 'icqq' }, kind: 'group', id: 'room' }, id: `m${++sequence}` },
    metadata: { platformSentAt: NOW }, event: {},
  });
  cleanups.push(async () => { resume.resolve(); engine.groupReviewQueue.stop(); for (const item of leases) item.lease.release(); await index.stop(); await store.close(); });
  return { adapter, accounts, one, two, index, store, signals, held, resume, engine, enqueue, completeText, sendTarget, recall, receive,
    activeLeases: () => leases.filter(item => !item.released).length,
    flush: () => vi.advanceTimersByTimeAsync(300) };
}

describe('deferred moderation Endpoint ownership', () => {
  it('finishes accepted review through its original captured Client after an unrelated HMR commit', async () => {
    const f = await fixture(), release = deferred(); let signal: AbortSignal | undefined;
    f.completeText.mockImplementationOnce(async input => { signal = input.signal; await release.promise; return result(input); });
    await f.receive(f.one); await f.flush();
    try {
      f.store.commit(0, { snapshot: f.store.current, dispose: () => undefined });
      expect(signal?.aborted).toBe(false);
    } finally { release.resolve(); }
    await vi.advanceTimersByTimeAsync(0);
    expect(f.one.sent).toHaveBeenCalledOnce();
    expect(f.two.sent).not.toHaveBeenCalled();
    expect(f.sendTarget).toHaveBeenCalledOnce();
    expect(f.activeLeases()).toBe(0);
  });

  it('cancels a detached review on explicit Root stop and releases every retained operation', async () => {
    const f = await fixture(); let signal: AbortSignal | undefined;
    f.completeText.mockImplementationOnce(async input => {
      signal = input.signal;
      await new Promise<void>((_resolve, reject) => {
        input.signal?.addEventListener('abort', () => reject(input.signal?.reason), { once: true });
      });
      return result(input);
    });
    await f.receive(f.one); await f.flush();
    const closing = f.store.close();
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
    await vi.advanceTimersByTimeAsync(0); await closing;
    expect(f.one.sent).not.toHaveBeenCalled(); expect(f.two.sent).not.toHaveBeenCalled();
    expect(f.activeLeases()).toBe(0);
  });

  it.each(['stop', 'update'] as const)('cancels pending review after inbound ends on %s without cancelling the other account', async action => {
    const f = await fixture(); await f.receive(f.one); await f.receive(f.two);
    const queued = f.enqueue.mock.calls.map(([input]) => input);
    expect(queued).toHaveLength(2); expect(f.completeText).not.toHaveBeenCalled();
    const changing = action === 'stop' ? f.adapter.stop(f.accounts[0]!.instanceId, f.adapter.revision)
      : f.adapter.update(f.accounts[0]!.instanceId, f.adapter.revision, { config: { id: '10001', changed: true } });
    await changing;
    expect(queued[0]!.signal.aborted).toBe(true); expect(queued[1]!.signal.aborted).toBe(false);
    expect(f.adapter.getEndpoint(f.accounts[1]!.instanceId)).toBe(f.two);
    await f.flush(); expect(f.one.inspect).not.toHaveBeenCalled(); expect(f.two.inspect).toHaveBeenCalledOnce();
    expect(f.completeText).toHaveBeenCalledOnce(); expect(f.sendTarget).toHaveBeenCalledOnce();
    if (action === 'update') {
      const replacement = f.adapter.getEndpoint(f.accounts[0]!.instanceId)!; expect(replacement).not.toBe(f.one);
      await f.receive(replacement, 'carol'); await f.flush(); expect(replacement.inspect).toHaveBeenCalledOnce();
    }
  });
  it.each(['model', 'management'] as const)('cancels an active deferred %s request after its original Message expires', async stage => {
    const f = await fixture(), release = deferred(); let signal!: AbortSignal;
    const wait = async (input: AbortSignal) => { signal = input; await Promise.race([release.promise, new Promise<void>((_resolve, reject) => {
      input.addEventListener('abort', () => reject(input.reason), { once: true });
    })]); };
    if (stage === 'model') f.completeText.mockImplementationOnce(async input => { await wait(input.signal!); return result(input); });
    else f.one.inspect.mockImplementationOnce(async (_group, _member, input) => { await wait(input); return { canModerate: true, joinedAt: NOW - 3600_000 }; });
    await f.receive(f.one); await f.flush(); expect(signal).toBeInstanceOf(AbortSignal);
    const stopping = f.adapter.stop(f.accounts[0]!.instanceId, f.adapter.revision);
    try {
      await vi.waitFor(() => expect(signal.aborted).toBe(true)); await stopping;
      expect(f.sendTarget).not.toHaveBeenCalled(); expect(f.recall).not.toHaveBeenCalled();
      await f.receive(f.two); await f.flush(); expect(f.two.inspect).toHaveBeenCalledOnce(); expect(f.sendTarget).toHaveBeenCalledOnce();
      expect(f.activeLeases()).toBe(0);
    } finally { release.resolve(); await vi.advanceTimersByTimeAsync(0); await stopping; }
  });
  it.each(['skip', 'throw'] as const)('releases the independent Endpoint lease on enqueue %s', async kind => {
    const f = await fixture();
    if (kind === 'throw') f.enqueue.mockRejectedValueOnce(new Error('synthetic queue admission failure'));
    await f.receive(f.one, 'alice', kind === 'skip' ? '' : undefined);
    await vi.advanceTimersByTimeAsync(0); expect(f.activeLeases()).toBe(0);
    expect((await f.adapter.stop(f.accounts[0]!.instanceId, f.adapter.revision)).execution.status).toBe('applied');
  });
  it.each(['handler', 'middleware'] as const)('binds the real %s CapabilityContext to the same operation signal', async stage => {
    const f = await fixture({ hold: stage }), running = f.receive(f.one);
    await f.held.promise;
    const captured = f.signals[stage]!;
    const stopping = f.adapter.stop(f.accounts[0]!.instanceId, f.adapter.revision);
    try {
      await vi.waitFor(() => expect(captured.session.aborted).toBe(true));
      expect(captured.context).toBe(captured.session); expect(captured.context.aborted).toBe(true);
      expect(f.adapter.getEndpoint(f.accounts[1]!.instanceId)).toBe(f.two);
    } finally { f.resume.resolve(); await running.catch(() => undefined); await stopping; }
  });
});
