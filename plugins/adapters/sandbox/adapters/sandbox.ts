/**
 * Convention entry: discover `adapters/sandbox.ts` → defineAdapter.
 */
import { defineAdapter } from '@zhin.js/adapter';
import { messageGatewayToken } from '@zhin.js/core/runtime';
import { httpHostToken } from '@zhin.js/host-http';
import { SandboxWsEndpoint } from '../src/endpoint.js';
import {
  resolveSandboxEndpoint,
  type SandboxAdapterConfig,
} from '../src/protocol.js';

export { SandboxWsEndpoint } from '../src/endpoint.js';
export type { SandboxEndpointOptions } from '../src/endpoint.js';

export default defineAdapter<SandboxAdapterConfig>({
  capabilities: ['inbound', 'outbound'],
  create(context) {
    return new SandboxWsEndpoint({
      id: context.id,
      gateway: context.use(messageGatewayToken),
      http: context.use(httpHostToken),
      defaults: resolveSandboxEndpoint(context.config),
    });
  },
});
