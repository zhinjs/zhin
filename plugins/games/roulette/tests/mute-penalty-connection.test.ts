import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { Adapter, createEndpointSpecification, defineAdapter, endpointSpec, type Endpoint } from 'zhin.js/adapter';
import { createAdapterHarness } from '../../../adapters/test-utils/endpoint.js';
import { MemoryDesiredRepository } from '../../../adapters/test-utils/desired-repository.js';
import { resolveMutePenalty } from '../src/mute-penalty.js';

class MuteClient extends EventEmitter {
  readonly mute = vi.fn(async (_group: string, _user: string, _duration: number) => undefined);
}
class MuteEndpoint extends MuteClient implements Endpoint {
  readonly [endpointSpec] = createEndpointSpecification(this, {
    start() {}, open() {}, close() {}, stop() {},
    management: { muteGroupMember: (group, user, duration) => this.mute(group, user, duration) },
  });
}
class MuteAdapter extends Adapter<MuteEndpoint> {
  protected createEndpoint() { return new MuteEndpoint(); }
}

describe('roulette guarded canonical management', () => {
  it('uses real Index management while connection exposes only data, and never calls a retired Client', async () => {
    const adapter = new MuteAdapter(), repository = new MemoryDesiredRepository();
    repository.snapshot = undefined;
    const h = await createAdapterHarness(defineAdapter({ capabilities: ['inbound'], createAdapter: () => adapter }),
      { endpoints: [{ id: 'one' }, { id: 'two' }] }, { name: 'synthetic', repository });
    await h.start(); h.open();
    const one = adapter.list()[0]!, two = adapter.list()[1]!;
    const old = adapter.getEndpoint(one.instanceId)!, other = adapter.getEndpoint(two.instanceId)!;
    const penalty = resolveMutePenalty({ project: () => h.index as never });
    const conversation = { endpointAdapter: 'synthetic', endpointId: one.canonicalId, kind: 'group', id: 'group' };
    try {
      expect(Reflect.get(h.index.connection('synthetic', one.canonicalId)!, 'management')).toBeUndefined();
      expect(penalty.support(conversation)).toBe('supported');
      await penalty.mute(conversation, 'user', 90);
      expect(old.mute).toHaveBeenCalledExactlyOnceWith('group', 'user', 90);
      expect(other.mute).not.toHaveBeenCalled();
      const captured = h.index.management(one.canonicalId)!;
      await adapter.stop(one.instanceId, adapter.revision);
      await adapter.start(one.instanceId, adapter.revision);
      const replacement = adapter.getEndpoint(one.instanceId)!;
      await expect(captured.muteGroupMember!('group', 'late', 90)).rejects.toMatchObject({ disposition: 'not_sent' });
      expect(old.mute).toHaveBeenCalledOnce(); expect(replacement.mute).not.toHaveBeenCalled();
      await penalty.mute(conversation, 'current', 90);
      expect(replacement.mute).toHaveBeenCalledExactlyOnceWith('group', 'current', 90);
      expect(other.mute).not.toHaveBeenCalled();
      expect(penalty.support({ ...conversation, endpointId: 'missing' })).toBe('unsupported');
      expect(penalty.support({ ...conversation, kind: 'private' })).toBe('not-a-group');
    } finally { await h.stop(); }
  });
});
