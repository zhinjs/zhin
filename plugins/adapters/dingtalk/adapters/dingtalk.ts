/**
 * Convention entry: discover `adapters/dingtalk.ts` → defineAdapter.
 */
import { defineAdapter } from '@zhin.js/adapter';
import { messageGatewayToken } from '@zhin.js/core/runtime';
import { httpHostToken } from '@zhin.js/host-http';
import { DingTalkEndpoint } from '../src/endpoint.js';
import {
  resolveDingTalkConfig,
  type DingTalkAdapterConfig,
} from '../src/protocol.js';
import { dingtalkRuntimeStateToken } from '../src/dingtalk-runtime-state.js';

export { DingTalkEndpoint } from '../src/endpoint.js';
export type { DingTalkEndpointOptions, DingTalkFetch } from '../src/endpoint.js';

export default defineAdapter<DingTalkAdapterConfig>({
  capabilities: ['inbound', 'outbound'],
  // 钉钉机器人媒体消息仅消费远程 URL；无按钮交互面，交互段降级纯文本。
  segments: {
    outboundMedia: ['url'],
    interactive: 'text',
  },
  create(context) {
    const config = resolveDingTalkConfig(context.config);
    // 注册到插件运行时状态（dingtalk.endpoint list 的"运行中"数据源）
    context.use(dingtalkRuntimeStateToken).endpoints.set(config.id, {
      id: config.id,
      mode: 'webhook',
    });
    return new DingTalkEndpoint({
      id: context.id,
      gateway: context.use(messageGatewayToken),
      http: context.use(httpHostToken),
      config,
    });
  },
});
