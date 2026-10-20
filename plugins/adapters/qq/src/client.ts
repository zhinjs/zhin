import { defineEndpointClient } from 'zhin.js/adapter';
import type { QqInboundMessage } from './protocol.js';
import type { QqBotTransport } from './ws.js';

export type QqClientEventMap = Record<string, QqInboundMessage | unknown>;

declare module '@zhin.js/feature-kit' {
  interface AdapterClientRegistry {
    readonly qq: {
      readonly client: QqBotTransport;
      readonly events: QqClientEventMap;
    };
  }
}

export const qqClient = defineEndpointClient<QqBotTransport, QqClientEventMap>('qq');
