/**
 * Convention entry: discover `adapters/slack.ts` → defineAdapter.
 */
import { defineAdapter } from '@zhin.js/adapter';
import { messageGatewayToken } from '@zhin.js/core/runtime';
import { httpHostToken } from '@zhin.js/host-http';
import { SlackEndpoint } from '../src/endpoint.js';
import {
  resolveSlackConfig,
  type SlackAdapterConfig,
} from '../src/protocol.js';
import { slackRuntimeStateToken } from '../src/slack-runtime-state.js';

export { SlackEndpoint } from '../src/endpoint.js';
export type { SlackEndpointOptions, SlackSocketLike, SlackWebClientLike } from '../src/endpoint.js';

export default defineAdapter<SlackAdapterConfig>({
  capabilities: ['inbound', 'outbound'],
  // 媒体由端点物化（url 拉取 / 本地读取）经 files.uploadV2 上传；
  // Block Kit 原生按钮承载交互段。
  segments: {
    outboundMedia: ['url', 'upload'],
    interactive: 'native',
  },
  create(context) {
    const config = resolveSlackConfig(context.config);
    // 注册到插件运行时状态（slack endpoint list 的"运行中"数据源）
    context.use(slackRuntimeStateToken).endpoints.set(config.name, {
      name: config.name,
      mode: config.mode,
    });
    if (config.mode === 'http') {
      return new SlackEndpoint({
        id: context.id,
        gateway: context.use(messageGatewayToken),
        http: context.use(httpHostToken),
        config,
      });
    }
    return new SlackEndpoint({
      id: context.id,
      gateway: context.use(messageGatewayToken),
      config,
    });
  },
});
