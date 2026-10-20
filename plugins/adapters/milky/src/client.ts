import {
  MilkyV1Client,
  type MilkyV1Event,
  type MilkyV1Response,
} from '@imhelper/milky-v1';
import {
  EventFactory,
  type EventMap,
  type ImHelperEventMap,
} from 'imhelper';
import {
  defineEndpointClient,
  forwardEndpointClientEvents,
  type ClientEventPayloads,
} from 'zhin.js/adapter';
import type { ResolvedMilkyConfig, callApi } from './protocol.js';

export { MilkyV1Client as MilkyClient } from '@imhelper/milky-v1';

type MilkyClientEvents = ImHelperEventMap<string, MilkyV1Event, EventMap<string>>;
export type MilkyClientEventMap = ClientEventPayloads<MilkyClientEvents>;

/** Construct the exact public imhelper Client without handing it transport ownership. */
export function createMilkyEndpointClient(
  config: ResolvedMilkyConfig,
  request: typeof callApi,
): MilkyV1Client {
  return new MilkyV1Client({
    baseUrl: config.baseUrl,
    selfId: config.id,
    accessToken: config.access_token,
    receiveMode: 'manual',
    call: (action, params) => request(
      {
        baseUrl: config.baseUrl,
        access_token: config.access_token,
      },
      action,
      params,
    ),
  });
}

/** Use the Client's complete protocol response while keeping Endpoint internals data-oriented. */
export async function callMilkyClient<T = unknown>(
  client: MilkyV1Client,
  action: string,
  params?: Record<string, unknown>,
): Promise<T | undefined> {
  const response: MilkyV1Response<T> = await client.call<T>(action, params);
  if (response.status !== 'ok') {
    throw new Error(
      `Milky API ${action}: retcode=${response.retcode}${response.message ? ` ${response.message}` : ''}`,
    );
  }
  return response.data;
}

const milkyClientEventNames = Object.freeze([
  ...EventFactory.getSupportedEventTypes<string>(),
  'event',
]);

export function forwardMilkyClientEvents(
  client: MilkyV1Client,
  receive: (name: string, payload: unknown) => void,
): () => void {
  return forwardEndpointClientEvents(client, milkyClientEventNames, receive);
}

declare module '@zhin.js/feature-kit' {
  interface AdapterClientRegistry {
    readonly milky: {
      readonly client: MilkyV1Client;
      readonly events: MilkyClientEventMap;
    };
  }
}

export const milkyClient = defineEndpointClient<MilkyV1Client, MilkyClientEventMap>('milky');
