import { defineEndpointClient, type EndpointEvent, type PlatformEvent } from '@zhin.js/adapter';
import { defineHandler, type HandlerContext } from '../src/feature/handler.js';

interface TestClient {
  lookupGroup(id: number): Promise<{ readonly id: number }>;
}

interface TestClientEvents {
  readonly ready: { readonly selfId: string };
  readonly 'group.join': { readonly groupId: number; readonly userId: string };
}

const testClient = defineEndpointClient<TestClient, TestClientEvents>('typed');

declare module '@zhin.js/feature-kit' {
  interface AdapterClientRegistry {
    readonly typed: {
      readonly client: TestClient;
      readonly events: TestClientEvents;
    };
  }
}

describe('defineHandler native events', () => {
  it('filters the unified platform ingress and exposes the exact Client/event types', async () => {
    const calls: number[] = [];
    const client: TestClient = {
      async lookupGroup(id) {
        calls.push(id);
        return { id };
      },
    };
    const handler = defineHandler({
      adapter: 'typed',
      event: 'group.join',
      async handle({ client: inferredClient, event, endpoint }) {
        const groupId: number = event.groupId;
        const adapter: string = endpoint.adapter;
        expect(adapter).toBe('typed');
        await inferredClient.lookupGroup(groupId);
      },
    });
    const context = {} as HandlerContext;

    await handler.handle.call(context, platformEvent('other', 'group.join', {
      groupId: 1,
      userId: 'u1',
    }, client));
    await handler.handle.call(context, platformEvent('typed', 'ready', {
      selfId: 'bot',
    }, client));
    await handler.handle.call(context, platformEvent('typed', 'group.join', {
      groupId: 42,
      userId: 'u2',
    }, client));

    expect(calls).toEqual([42]);
  });

  it('keeps the Client typed and unknown event payloads honest for wildcard handlers', async () => {
    const names: string[] = [];
    const handler = defineHandler({
      adapter: 'typed',
      event: '*',
      handle(received) {
        names.push(received.name);
        expect(received.client.lookupGroup).toBeTypeOf('function');
        expect(received.event).toBeTypeOf('object');
      },
    });
    const client: TestClient = {
      async lookupGroup(id) { return { id }; },
    };

    await handler.handle.call({} as HandlerContext, platformEvent('typed', 'ready', {
      selfId: 'bot',
    }, client));
    await handler.handle.call({} as HandlerContext, platformEvent('typed', 'group.join', {
      groupId: 42,
      userId: 'u2',
    }, client));

    expect(names).toEqual(['ready', 'group.join']);
  });
});

function platformEvent<TEvent>(
  adapter: string,
  name: string,
  event: TEvent,
  client: TestClient,
): EndpointEvent<PlatformEvent<TEvent>, TestClient, 'platform.receive'> {
  return Object.freeze({
    name: 'platform.receive',
    payload: Object.freeze({ name, event }),
    endpoint: Object.freeze({ id: `${adapter}-endpoint` as never, adapter }),
    client,
  });
}
