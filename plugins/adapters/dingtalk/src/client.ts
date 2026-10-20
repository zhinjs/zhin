import { defineEndpointClient } from 'zhin.js/adapter';
import type { DingTalkClient } from './endpoint.js';
import type { DingTalkEvent } from './protocol.js';

export type DingtalkClientEventMap = Record<string, DingTalkEvent>;

declare module '@zhin.js/feature-kit' {
  interface AdapterClientRegistry {
    readonly dingtalk: {
      readonly client: DingTalkClient;
      readonly events: DingtalkClientEventMap;
    };
  }
}

export const dingtalkClient = defineEndpointClient<DingTalkClient, DingtalkClientEventMap>('dingtalk');
