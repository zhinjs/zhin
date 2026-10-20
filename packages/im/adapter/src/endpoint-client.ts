import type { CapabilityContext } from '@zhin.js/feature-kit';
import { isAdapterIndex } from './adapter-index.js';
import { Endpoint } from './endpoint.js';
import { adapterFeatureId } from './provider.js';

const endpointClientBrand = 'zhin.endpoint-client/1' as const;

export type {
  AdapterClient,
  AdapterClientRegistry,
  AdapterClientTypes,
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

/**
 * Deep Endpoint base for SDK/protocol Clients.
 *
 * It owns the open admission gate and the single Client-event → Endpoint-event
 * bridge. Concrete Endpoints only own account transport and raw-event
 * normalization; they do not repeat dispatch plumbing.
 */
export abstract class ClientEndpoint<TClient = unknown> extends Endpoint<TClient> {
  #clientEventsOpen = false;
  #clientEventsRelease?: () => void;

  open(): void {
    this.#clientEventsOpen = true;
  }

  close(): void {
    this.#clientEventsOpen = false;
  }

  protected get clientEventsOpen(): boolean {
    return this.#clientEventsOpen;
  }

  protected bindClientEvents(
    subscribe: ClientEventSubscription,
    receive?: (name: string, payload: unknown) => void,
    onError?: (name: string, error: unknown) => void,
  ): void {
    this.#clientEventsRelease?.();
    this.#clientEventsRelease = subscribe((name, payload) => {
      if (!this.#clientEventsOpen) return;
      void this.emitPlatform(name, payload).catch((error) => onError?.(name, error));
      try {
        receive?.(name, payload);
      } catch (error) {
        onError?.(name, error);
      }
    });
  }

  protected releaseClientEvents(): void {
    this.#clientEventsRelease?.();
    this.#clientEventsRelease = undefined;
  }
}

/** Typed identity for one platform's native Client surface. */
export interface EndpointClientToken<TClient, TEvents extends object = Record<string, unknown>> {
  readonly $client: typeof endpointClientBrand;
  readonly adapter: string;
  /** @internal Type-only covariance anchor. */
  readonly _client?: TClient;
  /** @internal Type-only covariance anchor for native platform events. */
  readonly _events?: TEvents;
  /**
   * Resolve the Client from an operation context. Current inbound operations
   * infer their Endpoint; detached operations must provide `endpointKey`.
   */
  get(context: EndpointClientContext, endpointKey?: string): TClient;
  /** Resolve when this operation belongs to the platform; otherwise return undefined. */
  find(context: EndpointClientContext, endpointKey?: string): TClient | undefined;
}

/** Operation-scoped sources that can resolve an Endpoint Client. */
export interface EndpointClientContext {
  readonly project?: CapabilityContext['project'];
  readonly message?: unknown;
  readonly input?: unknown;
  readonly endpoint?: string;
  readonly origin?: unknown;
  readonly conversation?: unknown;
  readonly $client?: unknown;
  readonly clientAdapter?: string;
}

/** Declare the native Client type exported by a platform adapter. */
export function defineEndpointClient<
  TClient,
  TEvents extends object = Record<string, unknown>,
>(adapter: string): EndpointClientToken<TClient, TEvents> {
  const normalized = adapter.trim();
  if (!normalized) throw new TypeError('Endpoint Client adapter cannot be empty');
  const token: EndpointClientToken<TClient, TEvents> = {
    $client: endpointClientBrand,
    adapter: normalized,
    get(context, endpointKey) {
      return resolveEndpointClient(context, token, endpointKey);
    },
    find(context, endpointKey) {
      return findEndpointClient(context, token, endpointKey);
    },
  };
  return Object.freeze(token);
}

/**
 * Resolve a platform Client from the current generation.
 *
 * The returned object is valid only for the lifetime of `context`; callers
 * must not retain it beyond the current command, handler, tool, task, or
 * schedule operation.
 */
function resolveEndpointClient<TClient, TEvents extends object>(
  context: EndpointClientContext,
  token: EndpointClientToken<TClient, TEvents>,
  endpointKey?: string,
): TClient {
  if (token.$client !== endpointClientBrand) {
    throw new TypeError('Invalid Endpoint Client token');
  }
  const current = currentClientSource(context);
  if (current && '$client' in current) {
    if (endpointKey && !matchesCurrentEndpoint(current, endpointKey)) {
      throw new Error(
        `Endpoint Client ${endpointKey} does not match the current operation Endpoint`,
      );
    }
    if (current.clientAdapter && current.clientAdapter !== token.adapter) {
      throw new Error(
        `Endpoint Client ${token.adapter} cannot access ${current.clientAdapter}`,
      );
    }
    return current.$client as TClient;
  }
  const resolvedEndpointKey = endpointKey ?? endpointKeyFromContext(context);
  if (!resolvedEndpointKey) {
    throw new Error('Detached Endpoint Client access requires an explicit endpoint key');
  }
  if (!context.project) {
    throw new Error('Endpoint Client access requires a generation operation context');
  }
  const projection = context.project<unknown>(adapterFeatureId);
  if (!isAdapterIndex(projection)) {
    throw new Error('Adapter Feature projection is not installed');
  }
  return projection.client<TClient>(token.adapter, resolvedEndpointKey);
}

interface CurrentClientSource {
  readonly endpointId?: string;
  readonly clientAdapter?: string;
  readonly conversation?: unknown;
  readonly $client?: unknown;
}

function findEndpointClient<TClient, TEvents extends object>(
  context: EndpointClientContext,
  token: EndpointClientToken<TClient, TEvents>,
  endpointKey?: string,
): TClient | undefined {
  const current = currentClientSource(context);
  if (current && '$client' in current) {
    if (current.clientAdapter && current.clientAdapter !== token.adapter) return undefined;
    if (endpointKey && !matchesCurrentEndpoint(current, endpointKey)) return undefined;
    try {
      return current.$client as TClient;
    } catch {
      return undefined;
    }
  }
  const resolvedEndpointKey = endpointKey ?? endpointKeyFromContext(context);
  if (!resolvedEndpointKey || !context.project) return undefined;
  const projection = context.project<unknown>(adapterFeatureId);
  if (!isAdapterIndex(projection)) return undefined;
  return projection.findClient<TClient>(token.adapter, resolvedEndpointKey);
}

function currentClientSource(context: EndpointClientContext): CurrentClientSource | undefined {
  for (const candidate of [context, context.message, context.input]) {
    if (candidate && typeof candidate === 'object'
      && ('$client' in candidate || 'clientAdapter' in candidate)) {
      return candidate as CurrentClientSource;
    }
  }
  return undefined;
}

function matchesCurrentEndpoint(source: CurrentClientSource, endpointKey: string): boolean {
  const candidates = [source.endpointId, conversationEndpointId(source.conversation)]
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  return candidates.length === 0 || candidates.includes(endpointKey);
}

function endpointKeyFromContext(context: EndpointClientContext): string | undefined {
  if (typeof context.endpoint === 'string' && context.endpoint.length > 0) return context.endpoint;
  const origin = context.origin as { readonly kind?: unknown; readonly endpoint?: unknown } | undefined;
  if (origin?.kind === 'im' && typeof origin.endpoint === 'string' && origin.endpoint.length > 0) {
    return origin.endpoint;
  }
  return conversationEndpointId(context.conversation)
    ?? conversationEndpointId((context.input as { readonly conversation?: unknown } | undefined)?.conversation);
}

function conversationEndpointId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const endpoint = (value as { readonly endpoint?: unknown }).endpoint;
  if (!endpoint || typeof endpoint !== 'object') return undefined;
  const id = (endpoint as { readonly id?: unknown }).id;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}
