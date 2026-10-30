export type {
  AdapterClient,
  AdapterEvents,
  RegisteredAdapterName,
} from '@zhin.js/feature-kit';

/** Convert an EventEmitter-style tuple map into the payload map used by handlers. */
export type ClientEventPayloads<TEvents extends object> = {
  readonly [K in keyof TEvents]: TEvents[K] extends readonly [infer TPayload, ...unknown[]]
    ? TPayload
    : never;
};

interface ClientEventSource {
  on(name: string, listener: (payload: unknown) => void): unknown;
  off(name: string, listener: (payload: unknown) => void): unknown;
}

/**
 * Forward one Client's public event surface through the Endpoint boundary.
 * The returned disposer is useful when a Client can outlive its Endpoint.
 */
export function forwardEndpointClientEvents(
  client: ClientEventSource,
  names: readonly string[],
  receive: (name: string, payload: unknown) => void,
): () => void {
  const subscriptions = names.map((name) => {
    const listener = (payload: unknown) => receive(name, payload);
    client.on(name, listener);
    return { name, listener };
  });
  return () => {
    for (const { name, listener } of subscriptions) client.off(name, listener);
  };
}

export type ClientEventSubscription = (
  receive: (name: string, payload: unknown) => void,
) => () => void;
