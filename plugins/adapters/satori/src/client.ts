import {
  SatoriV1Client,
  type SatoriV1Event,
} from '@imhelper/satori-v1';
import { EventFactory, type EventMap, type ImHelperEventMap } from 'imhelper';
import {
  defineEndpointClient,
  forwardEndpointClientEvents,
  type ClientEventPayloads,
} from 'zhin.js/adapter';
import type {
  ResolvedSatoriConfig,
  SatoriApiOptions,
  callSatoriApi,
} from './protocol.js';

export { SatoriV1Client as SatoriClient } from '@imhelper/satori-v1';

type SatoriClientEvents = ImHelperEventMap<string, SatoriV1Event, EventMap<string>>;
export type SatoriClientEventMap = ClientEventPayloads<SatoriClientEvents>;

export function createSatoriEndpointClient(
  config: ResolvedSatoriConfig,
  request: typeof callSatoriApi,
  apiOptions: () => SatoriApiOptions,
): SatoriV1Client {
  return new SatoriV1Client({
    baseUrl: config.baseUrl,
    selfId: config.id,
    accessToken: config.token,
    receiveMode: 'manual',
    call: (resource, method, params) => request(apiOptions(), resource, method, params ?? {}),
  });
}

const satoriClientEventNames = Object.freeze([
  ...EventFactory.getSupportedEventTypes<string>(),
  'event',
]);

export function forwardSatoriClientEvents(
  client: SatoriV1Client,
  receive: (name: string, payload: unknown) => void,
): () => void {
  return forwardEndpointClientEvents(client, satoriClientEventNames, receive);
}

declare module '@zhin.js/feature-kit' {
  interface AdapterClientRegistry {
    readonly satori: {
      readonly client: SatoriV1Client;
      readonly events: SatoriClientEventMap;
    };
  }
}

export const satoriClient = defineEndpointClient<SatoriV1Client, SatoriClientEventMap>('satori');
