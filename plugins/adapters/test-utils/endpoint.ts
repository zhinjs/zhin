import {
  bindEndpoint,
  type AdapterContext,
  type Endpoint,
  type EndpointEvent,
  type EndpointEventGateway,
  type EndpointClientContext,
} from 'zhin.js/adapter';

interface LegacyOutboundMessageService {
  receive?(payload: unknown): unknown;
}

interface LegacySideEventGateway {
  receiveNotice?(payload: unknown): unknown;
  receiveRequest?(payload: unknown): unknown;
  receiveSystem?(payload: unknown): unknown;
}

/** Bind directly-constructed Endpoint instances to the same unified event shape used in Runtime. */
export function bindTestEndpoint<TEndpoint extends Endpoint>(
  endpoint: TEndpoint,
  messages?: LegacyOutboundMessageService,
  sideEvents?: LegacySideEventGateway,
): TEndpoint {
  const events: EndpointEventGateway = Object.freeze({
    async receive(event: EndpointEvent): Promise<unknown> {
      switch (event.name) {
        case 'message.receive':
          return messages?.receive?.(event.payload);
        case 'notice.receive':
          return sideEvents?.receiveNotice?.(event.payload);
        case 'request.receive':
          return sideEvents?.receiveRequest?.(event.payload);
        case 'system.receive':
          return sideEvents?.receiveSystem?.(event.payload);
        default:
          return undefined;
      }
    },
  });
  return bindTestEndpointEvents(endpoint, events);
}

/** Bind a direct Endpoint test through the same public event gateway as production. */
export function bindTestEndpointEvents<TEndpoint extends Endpoint>(
  endpoint: TEndpoint,
  events: EndpointEventGateway,
): TEndpoint {
  bindEndpoint(endpoint, {
    id: 'test-endpoint' as never,
    name: 'test-endpoint',
    use: () => events,
  } as unknown as AdapterContext);
  return endpoint;
}

export function endpointClientContext(endpoint: Endpoint): EndpointClientContext {
  return Object.freeze({
    message: Object.freeze({
      get $client() { return endpoint.client; },
    }),
  });
}
