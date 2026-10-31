import { EndpointDeliveryError } from '@zhin.js/im-contract';
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
  forwardEndpointClientEvents,
  type ClientEventPayloads,
  type PendingRpcRequest,
} from 'zhin.js/adapter';
import type { ResolvedMilkyConfig, callApi } from './protocol.js';

export { MilkyV1Client as MilkyClient } from '@imhelper/milky-v1';

type MilkyClientEvents = ImHelperEventMap<string, MilkyV1Event, EventMap<string>>;
export type MilkyClientEventMap = ClientEventPayloads<MilkyClientEvents>;

/** One account-bound transport, shared by native SDK and semantic requests. */
export interface MilkyClientBinding {
  readonly config: ResolvedMilkyConfig;
  readonly request: typeof callApi;
  readonly signal?: AbortSignal;
}
export type MilkyActionCaller = (request: PendingRpcRequest) => Promise<MilkyV1Response>;
export function createMilkyActionCaller({ config, request, signal }: MilkyClientBinding): MilkyActionCaller {
  return action => {
    const operationSignal = signal && action.signal ? AbortSignal.any([signal, action.signal]) : signal ?? action.signal;
    if (operationSignal?.aborted) throw new EndpointDeliveryError('endpoint_inactive', 'Endpoint request ended before submission', 'not_sent', { cause: operationSignal.reason });
    return request({ baseUrl: config.baseUrl, access_token: config.access_token, ...action, signal: operationSignal });
  };
}
export function milkyClientOptions({ config, call }: {
  readonly config: ResolvedMilkyConfig;
  readonly call: MilkyActionCaller;
}): ConstructorParameters<typeof MilkyV1Client>[0] {
  return { baseUrl: config.baseUrl, selfId: config.id, accessToken: config.access_token, receiveMode: 'manual',
    call: (action, params) => call({ action, params }),
  };
}

/**
 * Semantic ports must retain the SDK's status + retcode check when using its shared HTTP caller.
 * A contradictory envelope proves neither success nor rejection.
 * @see https://milky.ntqqrev.org/guide/communication
 */
export function readMilkyResponse<T = unknown>(response: unknown, action: string): T | undefined {
  if (response && typeof response === 'object') {
    const result = response as Partial<MilkyV1Response<unknown>>;
    if (result.status === 'ok' && result.retcode === 0) return result.data as T | undefined;
    if (result.status === 'failed' && Number.isSafeInteger(result.retcode) && result.retcode !== 0) {
      throw new EndpointDeliveryError('platform_rejected',
        `Milky API ${action}: retcode=${result.retcode}${typeof result.message === 'string' && result.message ? ` ${result.message}` : ''}`, 'rejected');
    }
  }
  throw new EndpointDeliveryError('delivery_unconfirmed', `Milky API ${action} did not confirm the action result`, 'unknown');
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
