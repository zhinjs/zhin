import { defineEndpointClient } from 'zhin.js/adapter';
import type { LarkClient } from './endpoint.js';
import type { LarkEventBody } from './protocol.js';

export type LarkClientEventMap = Record<string, LarkEventBody>;

declare module '@zhin.js/feature-kit' {
  interface AdapterClientRegistry {
    readonly lark: {
      readonly client: LarkClient;
      readonly events: LarkClientEventMap;
    };
  }
}

export const larkClient = defineEndpointClient<LarkClient, LarkClientEventMap>('lark');
