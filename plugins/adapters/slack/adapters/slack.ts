/**
 * Convention entry: discover `adapters/slack.ts` → defineAdapter.
 */
import { defineAdapter } from 'zhin.js/adapter';
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
  // 媒体段（canonical MediaRef）：kind=url 直发（image 走 attachment image_url，
  // 其余拉取后上传）；kind=base64 解码后经 files.uploadV2 上传；kind=path 读盘上传；
  // kind=file 无 Slack 对应物，丢弃留痕。Block Kit 原生按钮承载交互段。
  segments: {
    outboundMedia: ['url', 'upload', 'path'],
    interactive: 'native',
  },
  create(context) {
    const config = resolveSlackConfig(context.config);
    // 注册到插件运行时状态（slack.endpoint list 的"运行中"数据源）
    context.use(slackRuntimeStateToken).endpoints.set(config.id, {
      id: config.id,
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
