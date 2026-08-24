import {
  OneBotV12Client,
  type OneBotV12Event as ImHelperOneBot12Event,
  type OneBotV12Response,
} from '@imhelper/onebot-v12';
import { EventFactory, type EventMap, type ImHelperEventMap } from 'imhelper';
import {
  defineEndpointClient,
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

export function createOnebot12EndpointClient(
  config: ResolvedOneBot12Config,
  request: Onebot12ApiCall,
): OneBotV12Client {
  const baseUrl = config.connection === 'ws'
    ? config.url.replace(/^ws(s?):/, 'http$1:')
    : config.connection === 'webhook' && config.api_url
      ? config.api_url
      : 'http://localhost';
  return new OneBotV12Client({
    baseUrl,
    selfId: config.id,
    accessToken: config.access_token,
    receiveMode: 'manual',
    call: request,
  });
}

export async function callOnebot12Client<T = unknown>(
  client: OneBotV12Client,
  action: string,
  params?: Record<string, unknown>,
): Promise<T | undefined> {
  const response: OneBotV12Response<T> = await client.call<T>(action, params);
  if (response.status !== 'ok') {
    throw new Error(
      `OneBot 12 API ${action}: retcode=${response.retcode}${response.message ? ` ${response.message}` : ''}`,
    );
  }
  return response.data;
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

declare module '@zhin.js/feature-kit' {
  interface AdapterClientRegistry {
    readonly onebot12: {
      readonly client: OneBotV12Client;
      readonly events: Onebot12ClientEventMap;
    };
  }
}

export const onebot12Client = defineEndpointClient<OneBotV12Client, Onebot12ClientEventMap>('onebot12');
