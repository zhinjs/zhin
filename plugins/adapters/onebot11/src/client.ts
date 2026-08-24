import {
  OneBotV11Client,
  type OneBotV11Event as ImHelperOneBot11Event,
  type OneBotV11Response,
} from '@imhelper/onebot-v11';
import { EventFactory, type EventMap, type ImHelperEventMap } from 'imhelper';
import {
  defineEndpointClient,
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

export function createOnebot11EndpointClient(
  config: ResolvedOneBot11Config,
  request: Onebot11ApiCall,
): OneBotV11Client {
  return new OneBotV11Client({
    baseUrl: config.connection === 'ws'
      ? config.url.replace(/^ws(s?):/, 'http$1:')
      : 'http://localhost',
    selfId: config.id,
    accessToken: config.access_token,
    receiveMode: config.connection,
    ...(config.connection === 'wss' ? { path: config.path } : {}),
    call: request,
  });
}

export async function callOnebot11Client<T = unknown>(
  client: OneBotV11Client,
  action: string,
  params?: Record<string, unknown>,
): Promise<T | undefined> {
  const response: OneBotV11Response<T> = await client.call<T>(action, params);
  if (response.status !== 'ok') {
    throw new Error(
      `OneBot 11 API ${action}: retcode=${response.retcode}${response.message ? ` ${response.message}` : ''}`,
    );
  }
  return response.data;
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

declare module '@zhin.js/feature-kit' {
  interface AdapterClientRegistry {
    readonly onebot11: {
      readonly client: OneBotV11Client;
      readonly events: Onebot11ClientEventMap;
    };
  }
}

export const onebot11Client = defineEndpointClient<OneBotV11Client, Onebot11ClientEventMap>('onebot11');
