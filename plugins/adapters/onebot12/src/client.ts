import { readOnebot12Response } from './response.js';
export { readOnebot12Response } from './response.js';
import { EndpointDeliveryError } from '@zhin.js/im-contract';
import {
  OneBotV12Client,
  type OneBotV12Event as ImHelperOneBot12Event,
  type OneBotV12Response,
} from '@imhelper/onebot-v12';
import { ProtocolError, EventFactory, type EventMap, type ImHelperEventMap } from 'imhelper';
import {
  forwardEndpointClientEvents,
  type ClientEventPayloads,
} from 'zhin.js/adapter';
import type { ResolvedOneBot12Config } from './protocol.js';

export { OneBotV12Client as Onebot12Client } from '@imhelper/onebot-v12';

export type Onebot12ApiCall = (
  action: string,
  params?: Record<string, unknown>,
) => Promise<OneBotV12Response>;

type Onebot12ClientEvents = ImHelperEventMap<
  string,
  ImHelperOneBot12Event,
  EventMap<string>
>;
export type Onebot12ClientEventMap = ClientEventPayloads<Onebot12ClientEvents>;

export function onebot12ClientOptions(
  config: ResolvedOneBot12Config,
  request: Onebot12ApiCall,
): ConstructorParameters<typeof OneBotV12Client>[0] {
  const baseUrl = config.connection === 'ws'
    ? config.url.replace(/^ws(s?):/, 'http$1:')
    : config.connection === 'webhook'
      ? config.api_url
      : 'http://localhost';
  return {
    baseUrl,
    platform: config.platform,
    selfId: config.userId,
    accessToken: config.access_token,
    receiveMode: 'manual',
    call: request,
  };
}

export interface Onebot12ClientRequest {
  readonly client: OneBotV12Client;
  readonly action: string;
  readonly params?: Record<string, unknown>;
}
/** Native methods retain ProtocolError; framework ports preserve the underlying delivery evidence. */
export async function callOnebot12Client<T = unknown>(request: Onebot12ClientRequest): Promise<T | undefined> {
  try {
    return readOnebot12Response<T>(await request.client.call<T>(request.action, request.params));
  } catch (error) {
    if (error instanceof ProtocolError) {
      if (error.cause instanceof EndpointDeliveryError) throw error.cause;
      if (error.response !== undefined) readOnebot12Response(error.response);
    }
    throw error;
  }
}


const onebot12ClientEventNames = Object.freeze([
  ...EventFactory.getSupportedEventTypes<string>(),
  'event',
]);

export function forwardOnebot12ClientEvents(
  client: OneBotV12Client,
  receive: (name: string, payload: unknown) => void,
): () => void {
  return forwardEndpointClientEvents(client, onebot12ClientEventNames, receive);
}
