import { afterEach } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { defineAdapter, type AdapterContext, type EndpointCreationContext, type EndpointDesiredRepository,
  type EndpointDesiredSnapshot, type EndpointEventGateway } from 'zhin.js/adapter';
import { createAdapterHarness } from '../../test-utils/endpoint.js';
import { BilibiliAdapter } from '../src/adapter.js';
import { BilibiliEndpoint, type BilibiliEndpointOptions } from '../src/endpoint.js';
import { bilibiliEndpoints } from '../src/endpoint-directory.js';
import { resolveBilibiliConfig, type BilibiliEndpointConfig } from '../src/protocol.js';

const close: Array<() => Promise<void>> = [];
afterEach(async () => { for (const stop of close.splice(0)) await stop(); });

/** Real Bilibili Adapter ownership with offline protocol IO and an atomic fixture repository. */
export async function createBilibiliHarness(configuration: BilibiliEndpointConfig,
  options: Pick<BilibiliEndpointOptions, 'fetch' | 'stateDir' | 'now' | 'notify' | 'random'> = {},
  gateway?: EndpointEventGateway) {
  const root = rootPluginId();
  let state: EndpointDesiredSnapshot = { revision: 1, endpoints: [{ instanceId: 'bili-test-instance',
    canonicalId: capabilityId(root, featureId('zhin.adapter'), 'bilibili'), endpointId: configuration.id,
    config: configuration, revision: 1, desiredEnabled: true }] };
  const repository: EndpointDesiredRepository = {
    async load() { return structuredClone(state); },
    async compareAndSet(_id, expected, endpoints, commitId) {
      if (expected !== state.revision) throw new Error('Fixture revision conflict');
      state = structuredClone({ revision: state.revision + 1, endpoints, ...(commitId ? { commitId } : {}) }); return state;
    },
  };
  class FixtureAdapter extends BilibiliAdapter {
    constructor(context: AdapterContext<BilibiliEndpointConfig>) { super(context); }
    protected override createEndpoint(config: BilibiliEndpointConfig, execution: EndpointCreationContext): BilibiliEndpoint {
      return new BilibiliEndpoint({ ...options, id: execution.canonicalId, signal: execution.signal,
        configuration: config, config: resolveBilibiliConfig(config), autoPoll: false,
        reconcileLogin: login => this.acceptVerifiedLogin(execution, login) });
    }
  }
  const definition = defineAdapter<BilibiliEndpointConfig>({ capabilities: ['inbound', 'outbound'],
    createAdapter: context => new FixtureAdapter(context) });
  const harness = await createAdapterHarness(definition, configuration, { name: 'bilibili', repository, gateway });
  close.push(harness.stop);
  await harness.start(); harness.open();
  const endpoint = harness.endpoint;
  if (!endpoint) throw new Error('Offline Bilibili Endpoint did not start');
  const context = { owner: root, signal: new AbortController().signal, project: () => harness.index };
  return { ...harness, endpoint, context, directory: () => bilibiliEndpoints(context), saved: () => state };
}
