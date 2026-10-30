import { WecomAdapter } from '../../src/adapter.js';
/**
 * Convention entry: discover `adapters/wecom/index.ts` → defineAdapter.
 * Implementation lives under `src/` (endpoint / webhook / protocol).
 */
import { defineAdapter } from 'zhin.js/adapter';
import {
  type WecomEndpointConfig,
} from '../../src/protocol.js';

export { WecomEndpoint } from '../../src/endpoint.js';
export type { WecomEndpointOptions, WecomFetch } from '../../src/endpoint.js';

export default defineAdapter<WecomEndpointConfig>({
  capabilities: ['inbound', 'outbound'],
  operations: ['recall'],
  // image 段全部经 /cgi-bin/media/upload 物化为 media_id（url 下载后上传、
  // base64/path 直接上传、file 引用直用 media_id）；无卡片交互面，交互段降级纯文本。
  segments: {
    outboundMedia: ['upload'],
    interactive: 'text',
  },
  createAdapter: context => new WecomAdapter(context),
});
