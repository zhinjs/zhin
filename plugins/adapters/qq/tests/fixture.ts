import { vi } from 'vitest';
import { createEndpointHarness, createTestEventGateway } from '../../test-utils/endpoint.js';
import { QqWebsocketEndpoint, QqHttpEndpoint } from '../src/endpoint.js';

type FixtureMethod = (...args: unknown[]) => unknown;
function hasMethod<Key extends string>(target: object, key: Key): target is Record<Key, FixtureMethod> {
  return typeof Reflect.get(target, key) === 'function';
}

/** Keep installed Bot/Session/event/cache code; only replace the external auth/receiver/API IO. */
export async function qqFixture(factory: () => QqWebsocketEndpoint | QqHttpEndpoint, api: () => object,
  gateway?: Parameters<typeof createTestEventGateway>[0], sideEvents?: Parameters<typeof createTestEventGateway>[1]) {
  const fixture = await createEndpointHarness(() => {
    const endpoint = factory();
    endpoint.request.defaults.adapter = async () => { throw new Error('Unexpected unmocked QQ transport'); };
    const methods = api();
    const session = Reflect.get(endpoint, 'sessionManager') as { userClose: boolean; getAccessToken(): Promise<unknown> };
    vi.spyOn(session, 'getAccessToken').mockResolvedValue({ access_token: 'synthetic', expires_in: 3600 });
    vi.spyOn(endpoint.receiver, 'start').mockImplementation(async () => {
      await Reflect.get(methods, 'start')?.();
      if (session.userClose) return;
      Reflect.set(endpoint.receiver, '_isStarted', true);
      Reflect.set(endpoint.receiver, 'isClosed', false);
      Reflect.set(endpoint.receiver.handler, 'ws', { readyState: 1 });
      endpoint.receiver.emit('ready');
    });
    vi.spyOn(endpoint.receiver, 'stop').mockImplementation(async () => {
      Reflect.set(endpoint.receiver, '_isStarted', false);
      Reflect.set(endpoint.receiver, '_isReady', false);
      Reflect.set(endpoint.receiver, 'isClosed', true);
      Reflect.set(endpoint.receiver.handler, 'ws', undefined);
      await Reflect.get(methods, 'stop')?.();
    });
    const stub = (actual: object, supplied: object) => {
      for (const [key, value] of Object.entries(supplied)) {
        if (actual === endpoint && ['api', 'sent', 'start', 'stop', 'on', 'off', 'emit', 'removeAllListeners'].includes(key)) continue;
        if (actual === endpoint && key === 'middleware') {
          vi.spyOn(endpoint, 'middleware', 'get').mockReturnValue(value); continue;
        }
        const native = Reflect.get(actual, key);
        if (typeof value === 'function' && hasMethod(actual, key)) vi.spyOn(actual, key).mockImplementation((...args) => Reflect.apply(value, actual, args));
        else if (value && typeof value === 'object' && native && typeof native === 'object') stub(native, value);
        else throw new Error(`Unknown native QQ API method ${key}`);
      }
    };
    stub(endpoint, methods);
    return endpoint;
  }, { name: 'qq', capabilities: ['inbound', 'outbound'], operations: ['recall', 'reaction'],
    gateway: createTestEventGateway(gateway, sideEvents) });
  return { ...fixture,
    get management() { return fixture.index.management(fixture.canonicalId)!; },
    get control() { return fixture.index.control(fixture.canonicalId, 'recall')!; },
    get transportState() { return fixture.index.connection('qq', fixture.canonicalId)?.transportState; },
  };
}
