/**
 * Convention entry: discover `adapters/icqq.ts` → defineAdapter.
 */
import { defineAdapter } from '@zhin.js/adapter';
import { messageGatewayToken } from '@zhin.js/core/runtime';
import { IcqqIpcEndpoint } from '../src/endpoint.js';
import {
  resolveIcqqConfig,
  type IcqqAdapterConfig,
} from '../src/protocol.js';

export { IcqqIpcEndpoint } from '../src/endpoint.js';
export type {
  CreateIcqqIpc,
  IcqqEndpointOptions,
  IcqqIpcTransport,
} from '../src/endpoint.js';

export default defineAdapter<IcqqAdapterConfig>({
  capabilities: ['inbound', 'outbound'],
  create(context) {
    // Client-library / IPC daemon path — no httpHostToken.
    // Console loginAssist + host-router routes deferred.
    return new IcqqIpcEndpoint({
      id: context.id,
      gateway: context.use(messageGatewayToken),
      config: resolveIcqqConfig(context.config),
    });
  },
});
