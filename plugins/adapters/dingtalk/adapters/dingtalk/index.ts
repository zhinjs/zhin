/**
 * Convention entry: discover `adapters/dingtalk/index.ts` → defineAdapter.
 */
import { defineAdapter } from 'zhin.js/adapter';
import { httpHostToken } from '@zhin.js/host-http';
import { DingTalkEndpoint } from '../../src/endpoint.js';
import {
  resolveDingTalkConfig,
  type DingTalkEndpointConfig,
} from '../../src/protocol.js';
import { dingtalkRuntimeStateToken } from '../../src/dingtalk-runtime-state.js';

export { DingTalkEndpoint } from '../../src/endpoint.js';
export type { DingTalkEndpointOptions, DingTalkFetch } from '../../src/endpoint.js';

export default defineAdapter<DingTalkEndpointConfig>({
  capabilities: ['inbound', 'outbound'],
  // 钉钉机器人媒体消息仅消费远程 URL；Markdown 走原生 msgtype；
  // 原生按钮需配置固定互动卡片模板，由 Stream 接收回调。
  segments: {
    outboundMedia: ['url'],
    interactive: 'native',
    markdown: 'native',
  },
  create(context) {
    const config = resolveDingTalkConfig(context.config);
    // 注册到插件运行时状态（dingtalk endpoint list 的"运行中"数据源）
    context.use(dingtalkRuntimeStateToken).endpoints.set(config.id, {
      id: config.id,
      mode: config.mode ?? 'webhook',
    });
    return new DingTalkEndpoint({
      id: context.id,
      http: config.mode === 'stream' ? undefined : context.use(httpHostToken),
      config,
    });
  },
});
