import { defineEndpointClient } from 'zhin.js/adapter';
import type { WecomClient } from './endpoint.js';
import type { WecomMessage } from './protocol.js';

export type WecomClientEventMap = Record<string, WecomMessage>;

declare module '@zhin.js/feature-kit' {
  interface AdapterClientRegistry {
    readonly wecom: {
      readonly client: WecomClient;
      readonly events: WecomClientEventMap;
    };
  }
}

export const wecomClient = defineEndpointClient<WecomClient, WecomClientEventMap>('wecom');
