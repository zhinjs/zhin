import type { Client, EventMap } from '@icqqjs/icqq';
import { defineEndpointClient } from 'zhin.js/adapter';

type EventPayload<TListener> = TListener extends (
  event: infer TEvent,
  ...rest: readonly unknown[]
) => unknown
  ? TEvent
  : never;

/** The actual ICQQ SDK instance exposed by every ICQQ Endpoint event. */
export type IcqqClient = Client;

/** Native ICQQ event-name → first public event payload, derived from the SDK SSOT. */
export type IcqqClientEventMap = {
  readonly [TName in keyof EventMap]: EventPayload<EventMap[TName]>;
};

declare module '@zhin.js/feature-kit' {
  interface AdapterClientRegistry {
    readonly icqq: {
      readonly client: IcqqClient;
      readonly events: IcqqClientEventMap;
    };
  }
}

/** Typed, generation-checked identity used by handlers, commands, tools and schedules. */
export const icqqClient = defineEndpointClient<IcqqClient, IcqqClientEventMap>('icqq');
