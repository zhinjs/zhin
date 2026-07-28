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
  // Console UI 直接渲染 base64 内联媒体；交互段由 Console 原生承载。
  segments: {
    outboundMedia: ['base64'],
    interactive: 'native',
  },
  create(context) {
    return new SandboxWsEndpoint({
      id: context.id,
      gateway: context.use(messageGatewayToken),
      http: context.use(httpHostToken),
      defaults: resolveSandboxEndpoint(context.config),
    });
  },
});
