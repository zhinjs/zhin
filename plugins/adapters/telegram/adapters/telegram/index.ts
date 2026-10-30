/**
 * Convention entry: discover `adapters/telegram/index.ts` → defineAdapter.
 */
import { defineAdapter } from 'zhin.js/adapter';
import { TelegramAdapter } from '../../src/adapter.js';
import {
  type TelegramEndpointConfig,
} from '../../src/protocol.js';

export { TelegramEndpoint } from '../../src/endpoint.js';
export type { TelegramEndpointOptions, TelegramFetch } from '../../src/endpoint.js';

export default defineAdapter<TelegramEndpointConfig>({
  capabilities: ['inbound', 'outbound'],
  operations: ['recall'],
  // 媒体 url / file_id 直发，base64 / 本地路径经 multipart attach:// 上传物化；
  // inline keyboard 原生按钮承载交互段。
  segments: {
    outboundMedia: ['url', 'upload'],
    interactive: 'native',
    markdown: 'native',
  },
  createAdapter: context => new TelegramAdapter(context),
});
