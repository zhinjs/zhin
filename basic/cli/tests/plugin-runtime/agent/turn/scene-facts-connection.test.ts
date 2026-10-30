import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { Adapter, adapterFeatureId, createEndpointSpecification, defineAdapter, endpointSpec,
  type Endpoint, type EndpointManagement } from '@zhin.js/adapter';
import { createAdapterHarness } from '../../../../../../plugins/adapters/test-utils/endpoint.js';
import { MemoryDesiredRepository } from '../../../../../../plugins/adapters/test-utils/desired-repository.js';
import { SCENE_FACT_STALE_MS, SceneFactStore, SessionProfileStore } from '@zhin.js/agent';
import { SceneFactRefresher } from '../../../../src/plugin-runtime/agent/turn/scene-fact-refresher.js';
import { resolveRuntimeTurnContextState } from '../../../../src/plugin-runtime/agent/turn/request.js';

class SceneClient extends EventEmitter {
  readonly signals: AbortSignal[] = [];
  readonly inspect = vi.fn(async (_group: string, signal: AbortSignal) => {
    this.signals.push(signal);
    await new Promise<void>((_resolve, reject) => {
      const cancel = () => reject(signal.reason);
      if (signal.aborted) cancel();
      else signal.addEventListener('abort', cancel, { once: true });
    });
    return { name: 'Synthetic group' };
  });
}
class SceneEndpoint extends SceneClient implements Endpoint {
  readonly [endpointSpec] = createEndpointSpecification(this, {
    start: () => this[endpointSpec].reportSelfUserId('synthetic-bot'),
    open() {}, close() {}, stop() {},
    management: {
      inspectGroupScene: (group, signal) => this.inspect(group, signal),
      inspectGroupMemberProfile: async () => ({ platformRole: 'member' }),
    } satisfies EndpointManagement,
  });
}
class SceneAdapter extends Adapter<SceneEndpoint> {
  protected createEndpoint() { return new SceneEndpoint(); }
}

describe('scene facts through connection data and guarded management', () => {
  it.each(['turn-abort', 'account-stop'] as const)('uses the exact canonical account and cancels actual inspection on %s', async action => {
    const adapter = new SceneAdapter(), repository = new MemoryDesiredRepository();
    repository.snapshot = undefined;
    const h = await createAdapterHarness(defineAdapter({ capabilities: ['inbound'], createAdapter: () => adapter }),
      { id: 'synthetic-account' }, { name: 'icqq', repository });
    await h.start(); h.open();
    const row = adapter.list()[0]!, endpoint = adapter.getEndpoint(row.instanceId)!;
    const controller = new AbortController();
    const management = vi.spyOn(h.index, 'management');
    let stopping: ReturnType<SceneAdapter['stop']> | undefined;
    const request = resolveRuntimeTurnContextState({ projections: new Map([[adapterFeatureId, h.index]]) },
      { endpoint: { id: row.canonicalId, adapter: 'icqq' }, kind: 'group', id: 'synthetic-group' }, controller.signal, 'synthetic-sender');
    // Attach rejection handling before cancelling the live operation.
    const settled = request.then(value => ({ value }), error => ({ error }));
    try {
      await vi.waitFor(() => expect(endpoint.inspect).toHaveBeenCalledOnce());
      expect(management).toHaveBeenCalledWith(row.canonicalId);
      expect(h.index.connection('icqq', row.canonicalId)?.identity.id).toBe(row.canonicalId);
      expect(Reflect.get(h.index.connection('icqq', row.canonicalId)!, 'management')).toBeUndefined();
      expect(endpoint.signals[0]!.aborted).toBe(false);
      if (action === 'turn-abort') controller.abort(new Error('Synthetic turn retired'));
      else stopping = adapter.stop(row.instanceId, adapter.revision);
      await vi.waitFor(() => expect(endpoint.signals[0]!.aborted).toBe(true));
      const result = await settled;
      if (action === 'turn-abort') expect(result).toMatchObject({ error: { message: 'Synthetic turn retired' } });
      else expect(result).toMatchObject({ value: { bot: { id: 'synthetic-bot' } } });
      await stopping;
      expect(endpoint.inspect).toHaveBeenCalledOnce();
    } finally {
      controller.abort(new Error('Synthetic fixture cleanup'));
      await settled; await stopping; await h.stop();
    }
  });
});

it('keeps generation-owned queued scene refresh after the requesting turn ends, on its captured Client', async () => {
  const adapter = new SceneAdapter();
  const h = await createAdapterHarness(defineAdapter({ capabilities: ['inbound'], createAdapter: () => adapter }),
    { id: 'synthetic-account' }, { name: 'icqq' });
  await h.start(); h.open();
  const row = adapter.list()[0]!, endpoint = adapter.getEndpoint(row.instanceId)!;
  let now = Date.parse('2026-10-29T02:00:00Z');
  const store = new SceneFactStore(new SessionProfileStore(() => now), { now: () => now });
  await store.putGroup('icqq', 'group', 'group', { name: 'old' });
  await store.putBot('icqq', 'group', 'group', 'synthetic-bot', { platformRole: 'member' });
  await store.putMember('icqq', 'group', 'group', 'sender', { platformRole: 'member' });
  now += SCENE_FACT_STALE_MS + 1;
  const refresher = new SceneFactRefresher({ concurrency: 1 });
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  refresher.schedule('synthetic-hold', () => hold);
  let refreshSignal: AbortSignal | undefined;
  endpoint.inspect.mockImplementationOnce(async (_group, signal) => { refreshSignal = signal; return { name: 'fresh' }; });
  const turn = new AbortController();
  try {
    const state = await resolveRuntimeTurnContextState({ projections: new Map([[adapterFeatureId, h.index]]) },
      { endpoint: { id: row.canonicalId, adapter: 'icqq' }, kind: 'group', id: 'group' }, turn.signal, 'sender',
      { store, refresher, now: () => now });
    expect(state?.conversation?.name).toBe('old');
    expect(endpoint.inspect).not.toHaveBeenCalled();
    turn.abort(new Error('Synthetic turn completed'));
    release(); await refresher.idle();
    expect(endpoint.inspect).toHaveBeenCalledOnce();
    expect(refreshSignal).not.toBe(turn.signal);
    expect(refreshSignal?.aborted).toBe(false);
    expect((await store.getGroup('icqq', 'group', 'group'))?.facts.name).toBe('fresh');
  } finally { release(); refresher.dispose(); await refresher.idle(); await h.stop(); }
});
