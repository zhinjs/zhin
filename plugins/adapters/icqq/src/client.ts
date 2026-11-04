import type { IcqqAdapter } from './adapter.js';
import type { IcqqEndpoint } from './endpoint.js';
import type { EventMap } from '@icqqjs/icqq';

type EventPayload<TListener> = TListener extends (
  event: infer TEvent,
  ...rest: readonly unknown[]
) => unknown
  ? TEvent
  : never;

/** The actual ICQQ SDK instance exposed by every ICQQ Endpoint event. */
export type IcqqClient = IcqqEndpoint;

/** Native ICQQ event-name → first public event payload, derived from the SDK SSOT. */
export type IcqqClientEventMap = {
  readonly [TName in keyof EventMap]: EventPayload<EventMap[TName]>;
};

declare module '@zhin.js/feature-kit' {
  interface AdapterRegistry {
    readonly icqq: IcqqAdapter;
  }
}
