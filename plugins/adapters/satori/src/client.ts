import { EndpointDeliveryError } from '@zhin.js/im-contract';
import {
  SatoriV1Client,
  type SatoriV1Event,
} from '@imhelper/satori-v1';
import { EventFactory, type EventMap, type ImHelperEventMap } from 'imhelper';
import {
  forwardEndpointClientEvents,
  type ClientEventPayloads,
} from 'zhin.js/adapter';
import type {
  ResolvedSatoriConfig,
  callSatoriApi,
} from './protocol.js';

export { SatoriV1Client as SatoriClient } from '@imhelper/satori-v1';

type SatoriClientEvents = ImHelperEventMap<string, SatoriV1Event, EventMap<string>>;
export type SatoriClientEventMap = ClientEventPayloads<SatoriClientEvents>;

/** One account-bound caller is shared by native SDK and semantic ports. */
export interface SatoriActionRequest {
  readonly resource: string;
  readonly method: string;
  readonly params?: Record<string, unknown>;
  readonly signal?: AbortSignal;
}
export interface SatoriClientBinding {
  readonly config: ResolvedSatoriConfig;
  readonly request: typeof callSatoriApi;
  readonly signal?: AbortSignal;
}
export type SatoriActionCaller = (request: SatoriActionRequest) => Promise<unknown>;
export function createSatoriActionCaller({ config, request, signal }: SatoriClientBinding): SatoriActionCaller {
  return action => {
    const operationSignal = signal && action.signal ? AbortSignal.any([signal, action.signal]) : signal ?? action.signal;
    if (operationSignal?.aborted) throw new EndpointDeliveryError('endpoint_inactive', 'Endpoint request ended before submission', 'not_sent', { cause: operationSignal.reason });
    return request({ baseUrl: config.baseUrl, platform: config.platform, userId: config.userId,
      token: config.token, ...action, signal: operationSignal });
  };
}
export function satoriClientOptions({ config, call }: {
  readonly config: ResolvedSatoriConfig;
  readonly call: SatoriActionCaller;
}): ConstructorParameters<typeof SatoriV1Client>[0] {
  return { baseUrl: config.baseUrl, selfId: config.userId, platform: config.platform,
    accessToken: config.token, receiveMode: 'manual',
    call: (resource, method, params) => call({ resource, method, params: params ?? {} }),
  };
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
