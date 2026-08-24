import { defineEndpointClient } from 'zhin.js/adapter';
import type { KookClientTransport } from './ws.js';

export type KookClientEventMap = Record<string, unknown>;

declare module '@zhin.js/feature-kit' {
  interface AdapterClientRegistry {
    readonly kook: {
      readonly client: KookClientTransport;
      readonly events: KookClientEventMap;
    };
  }
}

export const kookClient = defineEndpointClient<KookClientTransport, KookClientEventMap>('kook');
