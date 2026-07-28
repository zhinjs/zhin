/**
 * Convention entry: discover `adapters/lark.ts` → defineAdapter.
 */
import { defineAdapter } from '@zhin.js/adapter';
import { messageGatewayToken } from '@zhin.js/core/runtime';
import { httpHostToken } from '@zhin.js/host-http';
import { LarkEndpoint } from '../src/endpoint.js';
import {
  resolveLarkConfig,
  type LarkAdapterConfig,
} from '../src/protocol.js';
import { larkRuntimeStateToken } from '../src/lark-runtime-state.js';

export { LarkEndpoint } from '../src/endpoint.js';
export type { LarkEndpointOptions, LarkFetch } from '../src/endpoint.js';

export default defineAdapter<LarkAdapterConfig>({
  capabilities: ['inbound', 'outbound'],
  create(context) {
    const config = resolveLarkConfig(context.config);
    // 注册到插件运行时状态（lark endpoint list 的"运行中"数据源）
    context.use(larkRuntimeStateToken).endpoints.set(config.name, {
      name: config.name,
      mode: 'webhook',
    });
    return new LarkEndpoint({
      id: context.id,
      gateway: context.use(messageGatewayToken),
      http: context.use(httpHostToken),
      config,
    });
  },
});
