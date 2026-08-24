import { defineEndpointClient } from 'zhin.js/adapter';
import type { OneBot11Event } from './protocol.js';

export type Onebot11ApiCall = (
  action: string,
  params?: Record<string, unknown>,
) => Promise<unknown>;

/** Transport-independent OneBot 11 Client produced by every Endpoint mode. */
export class Onebot11Client {
  constructor(readonly callApi: Onebot11ApiCall) {}

  async setTitle(groupId: number, userId: number, title: string, duration = -1): Promise<boolean> {
    await this.callApi('set_group_special_title', {
      group_id: groupId,
      user_id: userId,
      special_title: title,
      duration,
    });
    return true;
  }
}
export type Onebot11ClientEventMap = Record<string, OneBot11Event>;

declare module '@zhin.js/feature-kit' {
  interface AdapterClientRegistry {
    readonly onebot11: {
      readonly client: Onebot11Client;
      readonly events: Onebot11ClientEventMap;
    };
  }
}

export const onebot11Client = defineEndpointClient<Onebot11Client, Onebot11ClientEventMap>('onebot11');
