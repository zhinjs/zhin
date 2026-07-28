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
import { lineRuntimeStateToken } from '../src/line-runtime-state.js';

export { LineEndpoint } from '../src/endpoint.js';
export type { LineEndpointOptions, LineFetch } from '../src/endpoint.js';

export default defineAdapter<LineAdapterConfig>({
  capabilities: ['inbound', 'outbound'],
  create(context) {
    const config = resolveLineConfig(context.config);
    // 注册到插件运行时状态（line endpoint list 的"运行中"数据源）
    context.use(lineRuntimeStateToken).endpoints.set(config.name, {
      name: config.name,
      mode: 'webhook',
    });
    return new LineEndpoint({
      id: context.id,
      gateway: context.use(messageGatewayToken),
      http: context.use(httpHostToken),
      config,
    });
  },
});
