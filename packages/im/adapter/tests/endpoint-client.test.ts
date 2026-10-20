import { EventEmitter } from 'node:events';
import {
  ClientEndpoint,
  defineEndpointClient,
  type EndpointClientContext,
} from '../src/endpoint-client.js';
import { bindEndpoint, endpointEventGatewayToken } from '../src/endpoint.js';

interface NativeClient {
  readonly id: string;
  call(action: string): string;
}

const nativeClient = defineEndpointClient<NativeClient>('native');

class NativeEventEndpoint extends ClientEndpoint<EventEmitter> {
  readonly client = new EventEmitter();

  constructor() {
    super();
    this.bindClientEvents((receive) => {
      const listener = (payload: unknown) => receive('native.event', payload);
      this.client.on('native.event', listener);
      return () => this.client.off('native.event', listener);
    });
  }

  start(): void {}
  stop(): void {}
}

describe('ClientEndpoint', () => {
  it('owns the single open-gated Client event bridge', async () => {
    const receive = vi.fn(async () => undefined);
    const endpoint = new NativeEventEndpoint();
    bindEndpoint(endpoint, {
      id: 'native-endpoint',
      name: 'native',
      use: (token: unknown) => token === endpointEventGatewayToken ? { receive } : undefined,
    } as never);

    endpoint.client.emit('native.event', { phase: 'closed' });
    expect(receive).not.toHaveBeenCalled();

    endpoint.open();
    endpoint.client.emit('native.event', { phase: 'open' });
    await vi.waitFor(() => expect(receive).toHaveBeenCalledOnce());
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({
      name: 'platform.receive',
      payload: { name: 'native.event', event: { phase: 'open' } },
      client: endpoint.client,
    }));

    endpoint.close();
    endpoint.client.emit('native.event', { phase: 'closed-again' });
    expect(receive).toHaveBeenCalledOnce();
  });
});

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
