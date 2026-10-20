import { defineEndpointClient } from 'zhin.js/adapter';
import type { TelegramClient } from './endpoint.js';
import type { TelegramUpdate } from './protocol.js';

export type TelegramClientEventMap = Record<string, TelegramUpdate>;

declare module '@zhin.js/feature-kit' {
  interface AdapterClientRegistry {
    readonly telegram: {
      readonly client: TelegramClient;
      readonly events: TelegramClientEventMap;
    };
  }
}

export const telegramClient = defineEndpointClient<TelegramClient, TelegramClientEventMap>('telegram');
