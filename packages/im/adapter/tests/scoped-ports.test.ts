import { EventEmitter } from 'node:events';
import { Adapter, createEndpointSpecification, defineAdapter, endpointSpec, type Endpoint,
  type EndpointControl, type EndpointRecallRequest, type EndpointManagement, type EndpointMemberInspectionRequest } from '../src/index.js';
import { createAdapterHarness } from '../../../../plugins/adapters/test-utils/endpoint.js';
import { MemoryDesiredRepository } from '../../../../plugins/adapters/test-utils/desired-repository.js';

class NativeManagement implements EndpointManagement {
  readonly #friend = 'native-friend';
  fail = false;
  readonly seenSignals: AbortSignal[] = [];
  async listFriends() {
    if (this.fail) throw new Error('native lookup failed');
    return [{ user_id: this.#friend, nickname: 'Friend', remark: '' }];
  }
  async inspectGroupMember({ signal }: EndpointMemberInspectionRequest) {
    this.seenSignals.push(signal);
    return { canModerate: true };
  }
}
class NativeControl implements EndpointControl {
  readonly #messages: string[] = [];
  async recall({ message }: EndpointRecallRequest) { this.#messages.push(message.id); }
  get recalled(): readonly string[] { return this.#messages; }
}

/** Exercise prototype and literal ports through real account capture and retirement. */
async function fixture(options: { readonly freeze?: boolean } = {}) {
  const created: Array<{ management: NativeManagement; control: NativeControl }> = [];
  class NativeEndpoint extends EventEmitter implements Endpoint {
    readonly managementPort = new NativeManagement();
    readonly controlPort = new NativeControl();
    readonly [endpointSpec] = createEndpointSpecification(this, {
      start() {}, open() {}, close() {}, stop() {},
      management: options.freeze ? Object.freeze({ listFriends: () => this.managementPort.listFriends() }) : this.managementPort,
      control: this.controlPort,
    });
  }
  class NativeAdapter extends Adapter<NativeEndpoint> {
    protected createEndpoint() {
      const endpoint = new NativeEndpoint();
      created.push({ management: endpoint.managementPort, control: endpoint.controlPort });
      return endpoint;
    }
  }
  const adapter = new NativeAdapter();
  const repository = new MemoryDesiredRepository(); repository.snapshot = undefined;
  const harness = await createAdapterHarness(defineAdapter({ capabilities: ['inbound'], operations: ['recall'], createAdapter: () => adapter }),
    { id: 'native' }, { name: 'native', repository });
  await harness.start(); harness.open();
  return { ...harness, account: adapter, created };
}

it('retains class prototype methods and their private-field receiver in management and control', async () => {
  const h = await fixture();
  try {
    const management = h.index.management(h.canonicalId)!;
    const control = h.index.control(h.canonicalId, 'recall')!;
    expect(await management.listFriends!()).toEqual([{ user_id: 'native-friend', nickname: 'Friend', remark: '' }]);
    await control.recall!({ message: { conversation: { endpoint: { id: h.canonicalId, adapter: 'native' }, kind: 'group', id: 'room' }, id: 'mid' } });
    expect(h.created[0]!.control.recalled).toEqual(['mid']);
  } finally { await h.stop(); }
});

it('decorates frozen literal implementations without mutating them', async () => {
  const h = await fixture({ freeze: true });
  try { expect((await h.index.management(h.canonicalId)!.listFriends!())[0]!.user_id).toBe('native-friend'); }
  finally { await h.stop(); }
});

it('passes the explicitly declared signal slot and rejects retired prototype ports without rebinding', async () => {
  const h = await fixture();
  try {
    const captured = h.index.management(h.canonicalId)!;
    const caller = new AbortController();
    await captured.inspectGroupMember!({ groupId: 'room', userId: 'member', signal: caller.signal });
    expect(h.created[0]!.management.seenSignals[0]).toBeInstanceOf(AbortSignal);
    const account = h.account.list()[0]!;
    await h.account.stop(account.instanceId, h.account.revision);
    await h.account.start(account.instanceId, h.account.revision);
    await expect(captured.listFriends!()).rejects.toMatchObject({ disposition: 'not_sent' });
    expect(h.created[1]!.management.seenSignals).toEqual([]);
  } finally { await h.stop(); }
});

it('releases invocation leases when the original class method rejects', async () => {
  const h = await fixture();
  try {
    h.created[0]!.management.fail = true;
    await expect(h.index.management(h.canonicalId)!.listFriends!()).rejects.toThrow('native lookup failed');
  } finally { await h.stop(); }
});
