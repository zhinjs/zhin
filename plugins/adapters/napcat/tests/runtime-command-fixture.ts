import { afterEach, expect, vi } from 'vitest';
import { rootPluginId } from 'zhin.js';
import { AdapterManagementError, type AdapterDefinition, type EndpointDesiredRepository, type EndpointDesiredSnapshot } from 'zhin.js/adapter';
import { createAdapterHarness } from '../../test-utils/endpoint.js';

const stops: Array<() => Promise<void>> = [];
afterEach(async () => { for (const stop of stops.splice(0)) await stop(); });

/** Start a real empty Adapter directory; adding config must not create a Client or call a vendor. */
export async function runtimeCommandFixture<Config>(definition: AdapterDefinition<Config>, name: string, baseline: Config) {
  let state: EndpointDesiredSnapshot = { revision: 1, endpoints: [] };
  const compareAndSet = vi.fn<EndpointDesiredRepository['compareAndSet']>(async (_adapter, expected, endpoints, commitId) => {
    if (expected !== state.revision) throw new AdapterManagementError('conflict', 'Fixture CAS conflict');
    state = structuredClone({ revision: state.revision + 1, endpoints, commitId }); return state;
  });
  const harness = await createAdapterHarness(definition, baseline, { name, repository: { load: async () => structuredClone(state), compareAndSet } });
  stops.push(harness.stop); await harness.start(); harness.open();
  const context = (overrides: Record<string, unknown> = {}) => ({ owner: rootPluginId(), generation: 1,
    signal: new AbortController().signal, project: () => harness.index, params: {}, args: [], input: undefined,
    config: undefined, locale: 'zh-CN', use() { throw new Error('A runtime account command must not access startup file storage'); },
    ...overrides,
  }) as never;
  expect(harness.endpoint).toBeUndefined();
  return { harness, compareAndSet, context, saved: () => state };
}
