import { EventEmitter } from 'node:events';
import { RuntimeMessage } from '../../../../packages/im/core/src/plugin-runtime/im/contracts.js';
import { ZhinAgentEventEmitter } from '../../../../packages/im/agent/src/event/event-emitter.js';
import { activityFeedbackSource } from '@zhin.js/agent';
import { Adapter, createEndpointSpecification, defineAdapter, endpointSpec } from 'zhin.js/adapter';
import { createAdapterHarness } from '../../../adapters/test-utils/endpoint.js';
import { MemoryDesiredRepository } from '../../../adapters/test-utils/desired-repository.js';
import { createActivityFeedbackAIEventHandlers, createActivityFeedbackOrchestratorForRuntime } from '../src/ai-event-binder.js';
import { createOutboundEndpointAccess } from '../src/executor.js';
import type { OutboundHost } from 'zhin.js/plugin-runtime';

class NativeClient extends EventEmitter { readonly typingCalls = vi.fn(async (_conversation: unknown, _active?: boolean) => undefined); }
class NativeEndpoint extends NativeClient {
  readonly [endpointSpec] = createEndpointSpecification(this, {
    start() {}, open() {}, close() {}, stop() {},
    control: { typing: ({ conversation, active }) => this.typingCalls(conversation, active) },
  });
}
class TestAdapter extends Adapter<NativeEndpoint> { protected createEndpoint() { return new NativeEndpoint(); } }

it('stops feedback when its source account retires and never keeps typing through a replacement Client', async () => {
  vi.useFakeTimers();
  const adapter = new TestAdapter(), repository = new MemoryDesiredRepository(); repository.snapshot = undefined;
  const h = await createAdapterHarness(defineAdapter({ capabilities: ['inbound'], operations: ['typing'], createAdapter: () => adapter }),
    { endpoints: [{ id: 'one' }, { id: 'other' }] }, { name: 'synthetic', repository });
  await h.start(); h.open();
  const [account, other] = adapter.list(), old = adapter.getEndpoint(account!.instanceId)!;
  const source = h.index.acquire(account!.canonicalId, undefined, old);
  source.signal.addEventListener('abort', () => source.release(), { once: true });
  const releases = vi.fn();
  const outbound: OutboundHost = { send: vi.fn(), captureOperation: input => {
    const lease = h.index.acquire(input.target.endpoint.id as NonNullable<typeof account>['canonicalId'], input.signal, input.client);
    const control = h.index.control(lease.canonicalId, 'typing', () => lease.assertActive())!;
    return { target: input.target, signal: lease.signal, send: vi.fn(),
      typing: (conversation, active) => control.typing!({ conversation, active, signal: lease.signal }),
      release: () => { releases(); lease.release(); } };
  } };
  const orchestrator = createActivityFeedbackOrchestratorForRuntime({ defaults: { phases: { active: { group: { type: 'typing' } } } } },
    { debug() {}, error() {} }, createOutboundEndpointAccess(outbound));
  const target = { endpoint: { adapter: 'synthetic', id: account!.canonicalId }, kind: 'group' as const, id: 'group', threadId: 'thread' };
  const message = new RuntimeMessage({ conversation: target, content: 'synthetic', sender: { id: 'alice' }, message: { conversation: target, id: 'incoming' } }, {
    generation: 1, reply: async () => ({ status: 'sent' }), client: () => old, clientAdapter: 'synthetic',
    session: { adapter, endpoint: old, adapterName: 'synthetic', scene: target, event: {}, message: { text: 'synthetic', receivedAt: Date.now() }, signal: source.signal },
  });
  const payload = new ZhinAgentEventEmitter().createPayload('session', message, 'text', { hookContext: { activityFeedbackEligible: true } });
  const handlers = createActivityFeedbackAIEventHandlers(orchestrator);
  try {
    expect(payload[activityFeedbackSource]?.client).toBe(old);
    await handlers.onProcessingStart!(payload);
    expect(old.typingCalls).toHaveBeenCalledExactlyOnceWith(target, true);
    await adapter.stop(account!.instanceId, adapter.revision);
    expect(source.signal.aborted).toBe(true); expect(releases).toHaveBeenCalledOnce();
    await adapter.start(account!.instanceId, adapter.revision);
    const next = adapter.getEndpoint(account!.instanceId)!; expect(next).not.toBe(old);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(next.typingCalls).not.toHaveBeenCalled();
    await h.index.control(other!.canonicalId, 'typing')!.typing!({ conversation: { ...target, endpoint: { adapter: 'synthetic', id: other!.canonicalId } }, active: true });
    expect(adapter.getEndpoint(other!.instanceId)!.typingCalls).toHaveBeenCalledOnce();
  } finally { await orchestrator.dispose(); source.release(); await h.stop(); vi.useRealTimers(); }
});
