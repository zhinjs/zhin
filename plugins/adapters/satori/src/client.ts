import { defineEndpointClient } from 'zhin.js/adapter';
import type { SatoriEventBody } from './protocol.js';

export type SatoriClientCall = (
  resource: string,
  method: string,
  params: Record<string, unknown>,
) => Promise<unknown>;

/** Account-bound Satori API Client produced by both WS and Webhook Endpoints. */
export class SatoriClient {
  constructor(readonly callApi: SatoriClientCall) {}
}

export type SatoriClientEventMap = Record<string, SatoriEventBody>;

declare module '@zhin.js/feature-kit' {
  interface AdapterClientRegistry {
    readonly satori: {
      readonly client: SatoriClient;
      readonly events: SatoriClientEventMap;
    };
  }
}

export const satoriClient = defineEndpointClient<SatoriClient, SatoriClientEventMap>('satori');
