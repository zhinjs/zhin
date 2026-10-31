import { EventEmitter } from 'node:events';
import { AiGroupRules } from '@zhin.js/agent';
import { ToolApprovalQueue } from '@zhin.js/agent/security';
import { Adapter, createEndpointSpecification, defineAdapter, endpointSpec } from 'zhin.js/adapter';
import { createAdapterHarness } from '../../../../../../plugins/adapters/test-utils/endpoint.js';
import { MemoryDesiredRepository } from '../../../../../../plugins/adapters/test-utils/desired-repository.js';
import { GroupRuleEnforcer } from '../../../../src/plugin-runtime/agent/turn/group-rule-enforcer.js';

class NativeClient extends EventEmitter {
  readonly kicks = vi.fn(async (_group: string, _user: string) => undefined);
}
class NativeEndpoint extends NativeClient {
  readonly [endpointSpec] = createEndpointSpecification(this, {
    start() {}, open() {}, close() {}, stop() {},
    management: { inspectGroupMember: async () => ({ canModerate: true }),
      kickGroupMember: ({ groupId, userId }) => this.kicks(groupId, userId) },
  });
}
class TestAdapter extends Adapter<NativeEndpoint> { protected createEndpoint() { return new NativeEndpoint(); } }

it('cancels a pending kick on account stop and never executes it on a restarted Client', async () => {
  const adapter = new TestAdapter(), repository = new MemoryDesiredRepository(); repository.snapshot = undefined;
  const h = await createAdapterHarness(defineAdapter({ capabilities: ['inbound'], createAdapter: () => adapter }),
    { endpoints: [{ id: 'one' }, { id: 'other' }] }, { name: 'synthetic', repository });
  await h.start(); h.open();
  const [account, other] = adapter.list(), old = adapter.getEndpoint(account!.instanceId)!;
  const store = new AiGroupRules(), approvals = new ToolApprovalQueue();
  const drafted = await store.create({ platform: 'synthetic', sceneId: 'group:group', trigger: 'advertising',
    ladder: [{ action: 'suggest_kick' }], content: 'Synthetic rule', createdBy: 'owner', createdVia: 'model' });
  const pending = await store.submit({ id: drafted.record.id, expectedRevision: drafted.record.revision, actorId: 'owner' });
  await store.approve({ id: pending.record.id, expectedRevision: pending.record.revision, actorId: 'admin',
    approvedVia: 'im', contentHash: pending.record.contentHash });
  const enforcer = new GroupRuleEnforcer({ rules: () => store, approvals: () => approvals });
  const source = h.index.acquire(account!.canonicalId, undefined, old);
  const management = h.index.management(account!.canonicalId, () => source.assertActive())!;
  const release = vi.fn(() => source.release());
  try {
    const outcome = await enforcer.enforce({ platform: 'synthetic', endpoint: account!.canonicalId,
      groupId: 'group', memberId: 'member', trigger: 'advertising', sentAt: Date.now(), messageId: 'message' }, {
      signal: source.signal, send: async () => ({ status: 'sent' }),
      inspect: signal => management.inspectGroupMember!({ groupId: 'group', userId: 'member', signal }),
      mute: async () => undefined, kick: signal => management.kickGroupMember!({ groupId: 'group', userId: 'member', signal }), release,
    });
    expect(outcome).toMatchObject({ action: 'suggest_kick' });
    const [card] = approvals.list({ status: 'pending' }); expect(card).toBeDefined();
    expect(release).not.toHaveBeenCalled();
    await adapter.stop(account!.instanceId, adapter.revision);
    await enforcer.drain();
    expect(source.signal.aborted).toBe(true); expect(release).toHaveBeenCalledOnce();
    await adapter.start(account!.instanceId, adapter.revision);
    const next = adapter.getEndpoint(account!.instanceId)!;
    expect(next).not.toBe(old); expect(adapter.list()[0]!.canonicalId).toBe(account!.canonicalId);
    expect(approvals.resolve(card!.id, true, 'admin', { channel: 'im_approver_group' })).toBeUndefined();
    await enforcer.drain();
    expect(old.kicks).not.toHaveBeenCalled(); expect(next.kicks).not.toHaveBeenCalled();
    await h.index.management(other!.canonicalId)!.kickGroupMember!({ groupId: 'other-group', userId: 'other-member' });
    expect(adapter.getEndpoint(other!.instanceId)!.kicks).toHaveBeenCalledExactlyOnceWith('other-group', 'other-member');
  } finally { enforcer.dispose(); source.release(); await h.stop(); }
});

it('cancels an in-flight notice through the effect port when the enforcer is disposed', async () => {
  const rules = new AiGroupRules();
  const drafted = await rules.create({ platform: 'synthetic', sceneId: 'group:group', trigger: 'advertising',
    ladder: [{ action: 'remind' }], content: 'Synthetic rule', createdBy: 'owner', createdVia: 'model' });
  const pending = await rules.submit({ id: drafted.record.id, expectedRevision: drafted.record.revision, actorId: 'owner' });
  await rules.approve({ id: pending.record.id, expectedRevision: pending.record.revision, actorId: 'admin', approvedVia: 'im', contentHash: pending.record.contentHash });
  const enforcer = new GroupRuleEnforcer({ rules: () => rules }), source = new AbortController(), release = vi.fn();
  let received!: AbortSignal, entered!: () => void;
  const starting = new Promise<void>(resolve => { entered = resolve; });
  const work = enforcer.enforce({ platform: 'synthetic', endpoint: 'account', groupId: 'group', memberId: 'member',
    trigger: 'advertising', sentAt: Date.now() }, { signal: source.signal, release,
    send: async (_parts, signal) => { received = signal; entered(); await new Promise<void>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }); return { status: 'sent' }; }, mute: async () => undefined, kick: async () => undefined });
  await starting; expect(received.aborted).toBe(false); enforcer.dispose();
  await work; await enforcer.drain();
  expect(received.aborted).toBe(true); expect(source.signal.aborted).toBe(false); expect(release).toHaveBeenCalledOnce();
});
