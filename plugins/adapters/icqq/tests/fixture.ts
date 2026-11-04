import type { EndpointEventGateway } from 'zhin.js/adapter';
import { createEndpointHarness, createTestEventGateway } from '../../test-utils/endpoint.js';
import { IcqqEndpoint, type IcqqEndpointOptions } from '../src/endpoint.js';

/** Native Client under the real Adapter/Index; SDK calls use fixture.endpoint explicitly. */
export async function icqqFixture(options: IcqqEndpointOptions,
  gateway?: Parameters<typeof createTestEventGateway>[0],
  sideEvents?: Parameters<typeof createTestEventGateway>[1], events?: EndpointEventGateway) {
  const fixture = await createEndpointHarness(() => new IcqqEndpoint(options), {
    name: 'icqq', capabilities: ['inbound', 'outbound'], operations: ['recall', 'reaction'],
    gateway: events ?? createTestEventGateway(gateway, sideEvents),
  });
  return {
    ...fixture,
    get management() { return fixture.index.management(fixture.canonicalId)!; },
    get control() { return fixture.index.control(fixture.canonicalId, 'reaction')!; },
    get transportState() { return fixture.index.connection('icqq', fixture.canonicalId)?.transportState; },
    get selfUserId() { return fixture.index.connection('icqq', fixture.canonicalId)?.selfUserId; },
  };
}
