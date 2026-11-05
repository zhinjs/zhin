import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { defineAdapter, type AdapterContext, type EndpointCreationContext, type EndpointDesiredRepository, type EndpointDesiredSnapshot } from 'zhin.js/adapter';
import { createAdapterHarness, createEndpointHarness } from '../../test-utils/endpoint.js';
import { BilibiliAdapter } from '../src/adapter.js';
import { BilibiliEndpoint } from '../src/endpoint.js';
import type { BilibiliFetch } from '../src/client.js';
import { resolveBilibiliConfig, type BilibiliEndpointConfig } from '../src/protocol.js';

it.each(['login', 'video', 'dynamic'])('settles a transient %s startup error before an explicit fresh-Adapter startup', async stage => {
  const created: BilibiliEndpoint[] = [];
  let fail = true;
  const fetch = vi.fn<BilibiliFetch>(async url => {
    const current = url.includes('/nav') ? 'login' : url.includes('/view?') ? 'video' : 'dynamic';
    if (current === stage && fail) return { ok: false, status: 502, json: async () => ({}) };
    const data = current === 'login' ? { isLogin: true, mid: 99 }
      : current === 'video' ? { aid: 170001 }
      : { item: { id_str: '1073543151725051921', type: 'DYNAMIC_TYPE_WORD',
        basic: { comment_type: 17, comment_id_str: '1073543151725051921', rid_str: '' } } };
    return { ok: true, status: 200, json: async () => ({ code: 0, data }) };
  });
  const config = resolveBilibiliConfig({ id: 'startup', sessdata: 'synthetic-cookie',
    videos: ['BV1xx411c7mD'], dynamics: ['1073543151725051921'] });
  const createHarness = () => createEndpointHarness(() => {
    const endpoint = new BilibiliEndpoint({ id: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'startup'), config, fetch, autoPoll: false });
    created.push(endpoint); return endpoint;
  }, { name: 'bilibili' });
  const harness = await createHarness();
  try {
    await expect(harness.start()).rejects.toThrow(/502/);
    const failed = harness.index.describe()[0];
    expect(failed.transportState).toBe('stopped');
    expect(failed.phase).toBe('offline');
    expect(created).toHaveLength(1);
    const count = fetch.mock.calls.length;
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(count);
    fail = false;
    // A failed Root startup disposes its AdapterIndex. Retry constructs a fresh owner.
    const retried = await createHarness();
    try {
      await retried.start(); retried.open();
      expect(created).toHaveLength(2);
      expect(retried.index.describe()[0]).toMatchObject({ phase: 'online', transportState: 'open' });
      expect(retried.endpoint).not.toBe(created[0]);
    } finally { await retried.stop(); }
  } finally { await harness.stop(); }
});

it('settles a manual account-start failure and retries only when explicitly requested', async () => {
  const configuration: BilibiliEndpointConfig = { id: 'startup', sessdata: 'synthetic-cookie', dynamics: ['1073543151725051921'] };
  let state: EndpointDesiredSnapshot = { revision: 1, endpoints: [{ instanceId: 'startup-instance',
    canonicalId: capabilityId(rootPluginId(), featureId('zhin.adapter'), 'bilibili'), endpointId: 'startup',
    config: configuration, revision: 1, desiredEnabled: false }] };
  const repository: EndpointDesiredRepository = {
    async load() { return structuredClone(state); },
    async compareAndSet(_id, revision, endpoints, commitId) {
      if (revision !== state.revision) throw new Error('Unexpected concurrent fixture mutation');
      state = { revision: state.revision + 1, endpoints, ...(commitId ? { commitId } : {}) }; return structuredClone(state);
    },
  };
  let fail = true;
  const fetch = vi.fn<BilibiliFetch>(async url => {
    if (url.includes('/nav')) return { ok: true, status: 200, json: async () => ({ code: 0, data: { isLogin: true, mid: 99 } }) };
    if (fail) return { ok: false, status: 502, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ code: 0, data: { item: { id_str: '1073543151725051921',
      type: 'DYNAMIC_TYPE_WORD', basic: { comment_type: 17, comment_id_str: '1073543151725051921', rid_str: '' } } } }) };
  });
  class FixtureAdapter extends BilibiliAdapter {
    constructor(context: AdapterContext<BilibiliEndpointConfig>) { super(context); }
    protected override createEndpoint(config: BilibiliEndpointConfig, execution: EndpointCreationContext): BilibiliEndpoint {
      return new BilibiliEndpoint({ id: execution.canonicalId, config: resolveBilibiliConfig(config), fetch, autoPoll: false, signal: execution.signal });
    }
  }
  const harness = await createAdapterHarness(defineAdapter<BilibiliEndpointConfig>({ capabilities: ['inbound', 'outbound'],
    createAdapter: context => new FixtureAdapter(context) }), configuration, { name: 'bilibili', repository });
  try {
    await harness.start(); harness.open();
    const account = harness.adapter.list()[0];
    expect((await harness.adapter.start(account.instanceId, harness.adapter.revision)).execution.status).toBe('failed');
    expect(harness.index.describe()[0]).toMatchObject({ transportState: 'stopped', phase: 'offline' });
    const failedIncarnation = harness.adapter.list()[0].incarnationId;
    const count = fetch.mock.calls.length;
    await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(count);
    fail = false;
    expect((await harness.adapter.start(account.instanceId, harness.adapter.revision)).execution.status).toBe('applied');
    expect(harness.index.describe()[0]).toMatchObject({ transportState: 'open', phase: 'online' });
    expect(harness.adapter.list()[0].incarnationId).not.toBe(failedIncarnation);
  } finally { await harness.stop(); }
});
