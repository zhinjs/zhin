import { afterEach } from 'vitest';
import { capabilityId, featureId, rootPluginId } from 'zhin.js';
import { defineAdapter, type AdapterContext, type EndpointCreationContext, type EndpointDesiredRepository,
  type EndpointDesiredSnapshot, type EndpointEventGateway } from 'zhin.js/adapter';
import { createAdapterHarness } from '../../test-utils/endpoint.js';
import { JuejinAdapter } from '../src/adapter.js';
import { JuejinEndpoint, type JuejinEndpointOptions } from '../src/endpoint.js';
import { juejinEndpoints } from '../src/endpoint-directory.js';
import { resolveJuejinConfig, type JuejinEndpointConfig } from '../src/protocol.js';

const close: Array<() => Promise<void>> = [];
afterEach(async () => { for (const stop of close.splice(0)) await stop(); });

/** Real Juejin Adapter ownership with offline protocol IO and an atomic fixture repository. */
export async function createJuejinHarness(configuration: JuejinEndpointConfig,
  options: Pick<JuejinEndpointOptions, 'fetch' | 'stateDir' | 'now' | 'notify' | 'random'> = {},
  gateway?: EndpointEventGateway) {
  const root = rootPluginId();
  let state: EndpointDesiredSnapshot = { revision: 1, endpoints: [{ instanceId: 'juejin-test-instance',
    canonicalId: capabilityId(root, featureId('zhin.adapter'), 'juejin'), endpointId: configuration.id,
    config: configuration, revision: 1, desiredEnabled: true }] };
  const repository: EndpointDesiredRepository = {
    async load() { return structuredClone(state); },
    async compareAndSet(_id, expected, endpoints, commitId) {
      if (expected !== state.revision) throw new Error('Fixture revision conflict');
      state = structuredClone({ revision: state.revision + 1, endpoints, ...(commitId ? { commitId } : {}) }); return state;
    },
  };
  class FixtureAdapter extends JuejinAdapter {
    constructor(context: AdapterContext<JuejinEndpointConfig>) { super(context); }
    protected override createEndpoint(config: JuejinEndpointConfig, execution: EndpointCreationContext): JuejinEndpoint {
      return new JuejinEndpoint({ ...options, id: execution.canonicalId, signal: execution.signal,
        config: resolveJuejinConfig(config), autoPoll: false });
    }
  }
  const definition = defineAdapter<JuejinEndpointConfig>({ capabilities: ['inbound', 'outbound'],
    createAdapter: context => new FixtureAdapter(context) });
  const harness = await createAdapterHarness(definition, configuration, { name: 'juejin', repository, gateway });
  close.push(harness.stop);
  await harness.start(); harness.open();
  const endpoint = harness.endpoint;
  if (!endpoint) throw new Error('Offline Juejin Endpoint did not start');
  const context = { owner: root, signal: new AbortController().signal, project: () => harness.index };
  return { ...harness, endpoint, context, directory: () => juejinEndpoints(context), saved: () => state };
}
