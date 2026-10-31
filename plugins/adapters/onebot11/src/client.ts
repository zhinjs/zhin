import { EndpointDeliveryError } from '@zhin.js/im-contract';
import {
  OneBotV11Client,
  type OneBotV11Event as ImHelperOneBot11Event,
  type OneBotV11Response,
} from '@imhelper/onebot-v11';
import { ProtocolError, EventFactory, type EventMap, type ImHelperEventMap } from 'imhelper';
import {
  forwardEndpointClientEvents,
  type ClientEventPayloads,
} from 'zhin.js/adapter';
import type { ResolvedOneBot11Config } from './protocol.js';

export { OneBotV11Client as Onebot11Client } from '@imhelper/onebot-v11';

export type Onebot11ApiCall = (
  action: string,
  params?: Record<string, unknown>,
) => Promise<OneBotV11Response>;

type Onebot11ClientEvents = ImHelperEventMap<
  number,
  ImHelperOneBot11Event,
  EventMap<number>
>;
export type Onebot11ClientEventMap = ClientEventPayloads<Onebot11ClientEvents>;

export function onebot11ClientOptions(
  config: ResolvedOneBot11Config,
  request: Onebot11ApiCall,
): ConstructorParameters<typeof OneBotV11Client>[0] {
  return {
    baseUrl: config.connection === 'ws'
      ? config.url.replace(/^ws(s?):/, 'http$1:')
      : 'http://localhost',
    selfId: config.id,
    accessToken: config.access_token,
    receiveMode: 'manual',
    call: request,
  };
}

export interface Onebot11ClientRequest {
  readonly client: OneBotV11Client;
  readonly action: string;
  readonly params?: Record<string, unknown>;
}
/** Native methods retain ProtocolError; framework ports preserve the underlying delivery evidence. */
export async function callOnebot11Client<T = unknown>(request: Onebot11ClientRequest): Promise<T | undefined> {
  try {
    return readOnebot11Response<T>(await request.client.call<T>(request.action, request.params));
  } catch (error) {
    if (error instanceof ProtocolError) {
      if (error.cause instanceof EndpointDeliveryError) throw error.cause;
      if (error.response !== undefined) readOnebot11Response(error.response);
    }
    throw error;
  }
}

/**
 * Framework evidence follows the OB11 response envelope, including async/1 submission.
 * @see https://github.com/botuniverse/onebot-11/blob/master/communication/http.md
 */
export function readOnebot11Response<T = unknown>(response: unknown): T | undefined {
  if (response && typeof response === 'object') {
    const result = response as Partial<OneBotV11Response>;
    if (result.status === 'ok' && result.retcode === 0) return result.data as T | undefined;
    if (result.status === 'failed' && Number.isSafeInteger(result.retcode) && result.retcode !== 0 && result.retcode !== 1) {
      throw new EndpointDeliveryError('platform_rejected',
        `OneBot 11 API rejected: retcode=${result.retcode}${result.message ? ` ${result.message}` : ''}`, 'rejected');
    }
  }
  // OB11 async/1 acknowledges submission, never the final outcome.
  throw new EndpointDeliveryError('delivery_unconfirmed', 'OneBot 11 response did not confirm the action result', 'unknown');
}

const onebot11ClientEventNames = Object.freeze([
  ...EventFactory.getSupportedEventTypes<number>(),
  'event',
]);

export function forwardOnebot11ClientEvents(
  client: OneBotV11Client,
  receive: (name: string, payload: unknown) => void,
): () => void {
  return forwardEndpointClientEvents(client, onebot11ClientEventNames, receive);
}
