/** Authoring API for Handler Feature — implementation in `@zhin.js/handler`. */
export {
  parseHandlerDefinition,
  HandlerIndex,
  isHandlerIndex,
  handlerFeatureId,
  handlerFeature,
  handlerEventFromLocalName,
  resolveHandlerEvent,
  type HandlerEventMap,
  type HandlerDefinition,
  type HandlerDescriptor,
  type HandlerContext,
  type HandlerDispatchOptions,
} from '@zhin.js/handler';

import {
  defineHandler as defineHandlerFeature,
  type HandlerContext,
  type HandlerDefinition,
  type HandlerEventMap,
} from '@zhin.js/handler';

import type { Plugin } from '../plugin.js';
import type { Message } from '../plugin-runtime/im/contracts.js';
import type { Notice } from '../notice.js';
import type { Request } from '../request.js';
import type { SystemEvent } from '../system-event.js';
import type {
  AdapterClient,
  AdapterEvents,
  EndpointEvent,
  EndpointIdentity,
  PlatformEvent,
  RegisteredAdapterName,
} from '@zhin.js/adapter';

type KnownKeys<T> = {
  [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K];
};

declare module '@zhin.js/handler' {
  interface HandlerEventMap extends KnownKeys<Omit<Plugin.Lifecycle,
    'message.receive' | 'notice.receive' | 'request.receive' | 'system.receive'>> {
    'message.receive': [event: EndpointEvent<Message>];
    'notice.receive': [event: EndpointEvent<Notice>];
    'request.receive': [event: EndpointEvent<Request>];
    'system.receive': [event: EndpointEvent<SystemEvent>];
    'platform.receive': [event: EndpointEvent<PlatformEvent>];
  }
}

type NativeEventName<TAdapter extends RegisteredAdapterName> = Extract<
  keyof AdapterEvents<TAdapter>,
  string
>;

/** Fully inferred native platform event exposed to plugin handlers. */
export interface ClientHandlerEvent<
  TAdapter extends RegisteredAdapterName,
  TName extends NativeEventName<TAdapter> = NativeEventName<TAdapter>,
> {
  readonly name: TName;
  readonly event: AdapterEvents<TAdapter>[TName];
  readonly endpoint: EndpointIdentity;
  readonly client: AdapterClient<TAdapter>;
}

export interface ClientHandlerOptions<
  TAdapter extends RegisteredAdapterName,
  TName extends NativeEventName<TAdapter>,
> {
  readonly adapter: TAdapter;
  readonly event: TName;
  handle(
    this: HandlerContext,
    event: ClientHandlerEvent<TAdapter, TName>,
  ): void | Promise<void>;
}

export interface ClientHandlerWildcardEvent<TAdapter extends RegisteredAdapterName> {
  readonly name: string;
  readonly event: unknown;
  readonly endpoint: EndpointIdentity;
  readonly client: AdapterClient<TAdapter>;
}

export interface ClientHandlerWildcardOptions<TAdapter extends RegisteredAdapterName> {
  readonly adapter: TAdapter;
  readonly event: '*';
  handle(
    this: HandlerContext,
    event: ClientHandlerWildcardEvent<TAdapter>,
  ): void | Promise<void>;
}

/**
 * Define one generation-safe native platform handler with complete Client and
 * event-payload inference. Runtime dispatch still crosses only the canonical
 * `platform.receive` ingress; this authoring seam filters by adapter and event.
 */
interface RuntimeClientHandlerOptions {
  readonly adapter: string;
  readonly event: string;
  handle(this: HandlerContext, event: unknown): void | Promise<void>;
}

export function defineHandler<
  TAdapter extends RegisteredAdapterName,
  TName extends NativeEventName<TAdapter>,
>(options: ClientHandlerOptions<TAdapter, TName>): Readonly<HandlerDefinition<'platform.receive'>>;

/** Handle every native event from one Client without pretending unknown payloads are typed. */
export function defineHandler<TAdapter extends RegisteredAdapterName>(
  options: ClientHandlerWildcardOptions<TAdapter>,
): Readonly<HandlerDefinition<'platform.receive'>>;

export function defineHandler<K extends keyof HandlerEventMap & string>(options: {
  readonly event: K;
  handle(
    this: HandlerContext,
    ...args: HandlerEventMap[K] extends unknown[] ? HandlerEventMap[K] : unknown[]
  ): void | Promise<void>;
}): Readonly<HandlerDefinition<K>>;

export function defineHandler(
  options:
    | RuntimeClientHandlerOptions
    | { readonly event?: string; handle(this: HandlerContext, ...args: unknown[]): void | Promise<void> },
): Readonly<HandlerDefinition> {
  if (!('adapter' in options) || typeof options.adapter !== 'string') {
    return defineHandlerFeature(options as {
      readonly event?: string;
      handle(this: HandlerContext, ...args: unknown[]): void | Promise<void>;
    });
  }
  const adapter = options.adapter;
  const expectedName = options.event === '*' ? undefined : options.event;
  return defineHandlerFeature({
    event: 'platform.receive',
    async handle(this: HandlerContext, source: EndpointEvent<PlatformEvent>): Promise<void> {
      if (source.endpoint.adapter !== adapter) return;
      if (expectedName !== undefined && source.payload.name !== expectedName) return;
      const event = Object.freeze({
        name: source.payload.name,
        event: source.payload.event,
        endpoint: source.endpoint,
        client: source.client,
      });
      await (options.handle as (
        this: HandlerContext,
        event: unknown,
      ) => void | Promise<void>).call(this, event);
    },
  });
}
