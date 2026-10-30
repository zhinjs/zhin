import { vi } from 'vitest';
import { createEndpointHarness, createTestEventGateway } from '../../test-utils/endpoint.js';
import { SlackEndpoint, type SlackEndpointOptions } from '../src/endpoint.js';

type FixtureMethod = (...args: unknown[]) => unknown;
function hasMethod<Key extends string>(target: object, key: Key): target is Record<Key, FixtureMethod> {
  return typeof Reflect.get(target, key) === 'function';
}

/** Stub individual native API calls; never substitute a WebClient-shaped facade. */
function stubMethods(target: object, source: object): void {
  for (const key of Object.keys(source)) {
    const value: unknown = Reflect.get(source, key);
    const actual: unknown = Reflect.get(target, key);
    if (typeof value === 'function') {
      if (!hasMethod(target, key)) throw new Error(`Unknown native Slack API method ${key}`);
      vi.spyOn(target, key).mockImplementation((...args) => Reflect.apply(value, target, args));
    } else if (value && typeof value === 'object' && actual && typeof actual === 'object') stubMethods(actual, value);
    else throw new Error(`Unknown native Slack API namespace ${key}`);
  }
}

export async function slackFixture(options: SlackEndpointOptions, api: () => object,
  gateway?: Parameters<typeof createTestEventGateway>[0], sideEvents?: Parameters<typeof createTestEventGateway>[1]) {
  const fixture = await createEndpointHarness(() => {
    const endpoint = new SlackEndpoint({ ...options, webOptions: { ...options.webOptions,
      adapter: async () => { throw new Error('Unexpected unmocked Slack transport'); } } });
    stubMethods(endpoint, api());
    return endpoint;
  }, { name: 'slack', capabilities: ['inbound', 'outbound'], operations: ['recall', 'edit', 'reaction'],
    gateway: createTestEventGateway(gateway, sideEvents) });
  return { ...fixture,
    get management() { return fixture.index.management(fixture.canonicalId)!; },
    get control() { return fixture.index.control(fixture.canonicalId, 'recall')!; },
    get transportState() { return fixture.index.connection('slack', fixture.canonicalId)?.transportState; },
  };
}
