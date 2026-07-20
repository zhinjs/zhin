/**
 * Convention entry: discover `adapters/line.ts` → defineAdapter.
 */
import { defineAdapter } from '@zhin.js/adapter';
import { messageGatewayToken } from '@zhin.js/core/runtime';
import { httpHostToken } from '@zhin.js/host-http';
import { LineEndpoint } from '../src/endpoint.js';
import {
  resolveLineConfig,
  type LineAdapterConfig,
} from '../src/protocol.js';

export { LineEndpoint } from '../src/endpoint.js';
export type { LineEndpointOptions, LineFetch } from '../src/endpoint.js';

export default defineAdapter<LineAdapterConfig>({
  capabilities: ['inbound', 'outbound'],
  create(context) {
    return new LineEndpoint({
      id: context.id,
      gateway: context.use(messageGatewayToken),
      http: context.use(httpHostToken),
      config: resolveLineConfig(context.config),
    });
  },
});
