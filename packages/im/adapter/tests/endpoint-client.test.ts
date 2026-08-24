import {
  defineEndpointClient,
  type EndpointClientContext,
} from '../src/endpoint-client.js';

interface NativeClient {
  readonly id: string;
  call(action: string): string;
}

const nativeClient = defineEndpointClient<NativeClient>('native');

describe('EndpointClientToken.get', () => {
  it('infers the current Client from command and inbound middleware input', () => {
    const client: NativeClient = { id: 'bot', call: (action) => action };
    const context = {
      input: {
        endpointId: 'bot',
        clientAdapter: 'native',
        conversation: { endpoint: { id: 'capability-id' } },
        get $client() { return client; },
      },
    } as unknown as EndpointClientContext;

    expect(nativeClient.get(context)).toBe(client);
    expect(nativeClient.get(context, 'bot')).toBe(client);
    expect(nativeClient.get(context, 'capability-id')).toBe(client);
    expect(() => nativeClient.get(context, 'other')).toThrow(/does not match/);
    expect(nativeClient.find(context)).toBe(client);
    expect(defineEndpointClient<NativeClient>('other').find(context)).toBeUndefined();
  });

  it('resolves outbound middleware from its conversation endpoint', () => {
    const client: NativeClient = { id: 'outbound', call: (action) => action };
    const resolved: unknown[][] = [];
    const context = projectionContext(client, resolved, {
      input: { conversation: { endpoint: { id: 'native~main' } } },
    });

    expect(nativeClient.get(context)).toBe(client);
    expect(resolved).toEqual([['native', 'native~main']]);
  });

  it('infers an IM tool origin and requires detached tasks to select an endpoint', () => {
    const client: NativeClient = { id: 'tool', call: (action) => action };
    const resolved: unknown[][] = [];
    const imTool = projectionContext(client, resolved, {
      origin: { kind: 'im', platform: 'native', endpoint: 'bot-1' },
    });
    expect(nativeClient.get(imTool)).toBe(client);
    expect(resolved).toEqual([['native', 'bot-1']]);

    const detached = projectionContext(client, [], {});
    expect(() => nativeClient.get(detached)).toThrow(/explicit endpoint key/);
    expect(nativeClient.get(detached, 'bot-2')).toBe(client);
  });
});

function projectionContext(
  client: NativeClient,
  resolved: unknown[][],
  fields: Partial<EndpointClientContext>,
): EndpointClientContext {
  return {
    ...fields,
    project: () => ({
      $projection: 'zhin.adapter-index/1',
      client(adapter: string, endpointKey: string) {
        resolved.push([adapter, endpointKey]);
        return client;
      },
      findClient(adapter: string, endpointKey: string) {
        resolved.push([adapter, endpointKey]);
        return client;
      },
    }),
  } as EndpointClientContext;
}
