/**
 * Convention entry: discover `adapters/napcat.ts` → defineAdapter.
 */
import { defineAdapter } from '@zhin.js/adapter';
import { messageGatewayToken } from '@zhin.js/core/runtime';
import { httpHostToken } from '@zhin.js/host-http';
import { NapCatHttpEndpoint } from '../src/http-endpoint.js';
import { resolveNapCatConfig, type NapCatAdapterConfig } from '../src/protocol.js';
import { NapCatWsEndpoint } from '../src/ws-endpoint.js';
import { NapCatWssEndpoint } from '../src/wss-endpoint.js';

export {
  NapCatHttpEndpoint,
  type NapCatHttpEndpointOptions,
} from '../src/http-endpoint.js';
export {
  NapCatWsEndpoint,
  type NapCatWsEndpointOptions,
} from '../src/ws-endpoint.js';
export {
  NapCatWssEndpoint,
  type NapCatWssEndpointOptions,
} from '../src/wss-endpoint.js';
export type { NapCatWsSocket, NapCatWsCreateOptions } from '../src/ws-types.js';

export default defineAdapter<NapCatAdapterConfig>({
  capabilities: ['inbound', 'outbound'],
  create(context) {
    const config = resolveNapCatConfig(context.config);
    const gateway = context.use(messageGatewayToken);
    if (config.connection === 'wss') {
      return new NapCatWssEndpoint({ id: context.id, gateway, http: context.use(httpHostToken), config });
    }
    if (config.connection === 'http') {
      return new NapCatHttpEndpoint({ id: context.id, gateway, http: context.use(httpHostToken), config });
    }
    return new NapCatWsEndpoint({ id: context.id, gateway, config });
  },
});
