import { AgentEventBus, activityFeedbackSource, type AIEventPayload } from '@zhin.js/agent';
import { agentEventBusToken } from '@zhin.js/agent/runtime';
import { createFakePlugin, fakeOf, fakeResource } from '@zhin.js/testing';
import { SnapshotStore, outboundHostToken, type HmrResumeDetails, type OutboundHost } from 'zhin.js/plugin-runtime';
import plugin from '../plugin.ts';

it('keeps captured feedback until its own committed replacement outcome, then cleans without a new generation lookup', async () => {
  const bus = new AgentEventBus(), client = {};
  const target = { endpoint: { adapter: 'synthetic', id: 'canonical' }, kind: 'group' as const,
    id: 'group', parent: { kind: 'channel' as const, id: 'parent' }, threadId: 'thread' };
  const recall = vi.fn(async () => undefined), release = vi.fn(), send = vi.fn(async () => 'status');
  const captureOperation = vi.fn(() => ({ target, signal: new AbortController().signal, send, recall, release }));
  const runWithView = vi.fn(async <T>(operation: () => Promise<T>) => operation());
  const host: OutboundHost = { send: vi.fn(), captureOperation, runWithView };
  const owner = createFakePlugin({ config: { defaults: { phases: {
    active: { group: { type: 'message' as const, message: 'Working', autoRemove: true } },
  } } }, hosts: { database: false, schedule: false, outbound: false }, resources: [
    fakeResource(agentEventBusToken, bus), fakeResource(outboundHostToken, host),
  ] });
  await owner.setup(plugin);
  owner.resources.seal();
  const state = { root: owner.id, tree: new Map(), config: new Map(), capabilities: new Map(), projections: new Map(),
    resources: new Map([[owner.id, owner.resources.snapshot()]]) };
  const snapshots = new SnapshotStore(state);
  const event = fakeOf<AIEventPayload>({ platform: 'synthetic', endpointKey: 'display-alias', sessionId: 'session',
    messageId: 'incoming', scope: 'group', sceneId: 'group', userId: 'user', hookContext: { activityFeedbackEligible: true } });
  Object.defineProperty(event, activityFeedbackSource, { value: { target, client, signal: new AbortController().signal } });
  const complete = (patch: Partial<HmrResumeDetails>) => owner.dispatchLifecycle('hmr.resume', {
    signal: new AbortController().signal, details: { trigger: 'source', changed: ['/fixture/plugin.ts'],
      planned: { fullRoot: false, plugins: [owner.id], capabilities: [] }, previousGeneration: 0, activeGeneration: 1,
      receiver: { owner: owner.id, creationGeneration: 0, state: 'replaced' }, outcome: 'committed', replaced: [owner.id], ...patch },
  });
  try {
    await bus.dispatch('ai.processing.start', event);
    expect(send).toHaveBeenCalledOnce();
    snapshots.commit(0, { snapshot: { ...state, resources: new Map() }, dispose: () => undefined });
    expect(recall).not.toHaveBeenCalled();
    runWithView.mockImplementation(async () => { throw new Error('retired facades reject new calls'); });
    await complete({ outcome: 'rejected', replaced: [] });
    await complete({ receiver: { owner: owner.id, creationGeneration: 0, state: 'current' }, replaced: [] });
    expect(recall).not.toHaveBeenCalled();
    await complete({});
    expect(recall).toHaveBeenCalledExactlyOnceWith({ conversation: target, id: 'status' });
    expect(release).toHaveBeenCalledOnce();
    expect(captureOperation).toHaveBeenCalledOnce();
    await bus.dispatch('ai.processing.start', event);
    expect(send).toHaveBeenCalledOnce();
  } finally { await owner.dispose(); await snapshots.close(); }
});
