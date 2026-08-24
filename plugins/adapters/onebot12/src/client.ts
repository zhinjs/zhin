import { defineEndpointClient } from 'zhin.js/adapter';
import type { OneBot12Event } from './protocol.js';

export type Onebot12ApiCall = (
  action: string,
  params?: Record<string, unknown>,
) => Promise<unknown>;

/** Transport-independent OneBot 12 Client produced by every Endpoint mode. */
export class Onebot12Client {
  constructor(readonly callApi: Onebot12ApiCall) {}
}

export type Onebot12ClientEventMap = Record<string, OneBot12Event>;

declare module '@zhin.js/feature-kit' {
  interface AdapterClientRegistry {
    readonly onebot12: {
      readonly client: Onebot12Client;
      readonly events: Onebot12ClientEventMap;
    };
  }
}

export const onebot12Client = defineEndpointClient<Onebot12Client, Onebot12ClientEventMap>('onebot12');
