/**
 * Convention entry: discover `adapters/slack/index.ts` → defineAdapter.
 */
import { defineAdapter } from 'zhin.js/adapter';
import { SlackAdapter } from '../../src/adapter.js';
import {
  type SlackEndpointConfig,
} from '../../src/protocol.js';

export { SlackEndpoint } from '../../src/endpoint.js';
export type { SlackEndpointOptions, SlackSocketLike, SlackWebClientLike } from '../../src/endpoint.js';

export default defineAdapter<SlackEndpointConfig>({
  capabilities: ['inbound', 'outbound'],
  operations: ['recall', 'edit', 'reaction'],
  // 媒体段（canonical MediaRef）：kind=url 直发（image 走 attachment image_url，
  // 其余拉取后上传）；kind=base64 解码后经 files.uploadV2 上传；kind=path 读盘上传；
  // kind=file 无 Slack 对应物，丢弃留痕。Block Kit 原生按钮承载交互段。
  segments: {
    outboundMedia: ['url', 'upload', 'path'],
    interactive: 'native',
    markdown: 'native',
  },
  createAdapter: context => new SlackAdapter(context),
});
