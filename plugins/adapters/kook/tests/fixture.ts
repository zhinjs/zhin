import { vi } from 'vitest';
import { createEndpointHarness, createTestEventGateway } from '../../test-utils/endpoint.js';
import { KookWebsocketEndpoint, KookWebhookEndpoint } from '../src/endpoint.js';

export async function kookFixture(factory: () => KookWebsocketEndpoint | KookWebhookEndpoint, api: () => object,
  gateway?: Parameters<typeof createTestEventGateway>[0], sideEvents?: Parameters<typeof createTestEventGateway>[1]) {
  const fixture = await createEndpointHarness(() => {
    const endpoint = factory();
    endpoint.request.defaults.adapter = async () => { throw new Error('Unexpected unmocked KOOK transport'); };
    for (const [key, value] of Object.entries(api())) {
      if (key === 'sent' || key === 'on' || key === 'removeAllListeners' || key === 'receiver') continue;
      if (key === 'self_id') { Reflect.set(endpoint, key, value); continue; }
      if (typeof value !== 'function' || typeof Reflect.get(endpoint, key) !== 'function') {
        throw new Error(`Unknown native KOOK API method ${key}`);
      }
      vi.spyOn(endpoint, key as never).mockImplementation(value as never);
    }
    return endpoint;
  }, { name: 'kook', capabilities: ['inbound', 'outbound'], operations: ['recall'],
    gateway: createTestEventGateway(gateway, sideEvents) });
  return { ...fixture,
    get management() { return fixture.index.management(fixture.canonicalId)!; },
    get control() { return fixture.index.control(fixture.canonicalId, 'recall')!; },
    get transportState() { return fixture.index.connection('kook', fixture.canonicalId)?.transportState; },
  };
}
