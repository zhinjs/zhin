import { LarkAdapter } from '../../src/adapter.js';
/**
 * Convention entry: discover `adapters/lark/index.ts` → defineAdapter.
 */
import { defineAdapter } from 'zhin.js/adapter';
import {
  type LarkEndpointConfig,
} from '../../src/protocol.js';

export { LarkEndpoint } from '../../src/endpoint.js';
export type { LarkEndpointOptions, LarkFetch } from '../../src/endpoint.js';

export default defineAdapter<LarkEndpointConfig>({
  capabilities: ['inbound', 'outbound'],
  operations: ['recall'],
  // image 段 canonical MediaRef 经 /im/v1/images 物化为 image_key
  // （base64 解码 / path 读盘 / url 下载后上传，kind=file 平台引用直通）；
  // canonical Markdown 由 endpoint codec 转为 lark_md 消息卡片；
  // 卡片交互未接入出站通道，交互段降级纯文本。
  segments: {
    outboundMedia: ['url', 'upload'],
    interactive: 'native',
    markdown: 'native',
  },
  createAdapter: context => new LarkAdapter(context),
});
