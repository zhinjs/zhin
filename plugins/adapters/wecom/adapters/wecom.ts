/**
 * Convention entry: discover `adapters/wecom.ts` → defineAdapter.
 * Implementation lives under `src/` (endpoint / webhook / protocol).
 */
import { defineAdapter } from '@zhin.js/adapter';
import { messageGatewayToken } from '@zhin.js/core/runtime';
import { httpHostToken } from '@zhin.js/host-http';
import { WecomEndpoint } from '../src/endpoint.js';
import {
  resolveWecomConfig,
  type WecomAdapterConfig,
} from '../src/protocol.js';
import { wecomRuntimeStateToken } from '../src/wecom-runtime-state.js';

export { WecomEndpoint } from '../src/endpoint.js';
export type { WecomEndpointOptions, WecomFetch } from '../src/endpoint.js';

export default defineAdapter<WecomAdapterConfig>({
  capabilities: ['inbound', 'outbound'],
  create(context) {
    const config = resolveWecomConfig(context.config);
    // 注册到插件运行时状态（wecom endpoint list 的"运行中"数据源）
    context.use(wecomRuntimeStateToken).endpoints.set(config.name, {
      name: config.name,
      mode: 'webhook',
    });
    return new WecomEndpoint({
      id: context.id,
      gateway: context.use(messageGatewayToken),
      http: context.use(httpHostToken),
      config,
    });
  },
});
