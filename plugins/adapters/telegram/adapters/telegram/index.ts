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
  // 媒体 url / file_id 直发，base64 / 本地路径经 multipart attach:// 上传物化；
  // inline keyboard 原生按钮承载交互段。
  profile: {
    default: {
      messaging: {
        segments: {
          outboundMedia: ['url', 'upload'],
          interactive: 'native',
          markdown: 'native',
        },
        quote: true,
        recall: { timeLimitSeconds: 172800 },
      },
      actions: {
        recall: {
          scopes: ['private', 'group', 'channel'],
          params: { timeLimitSeconds: 172800 },
        },
        quoteReply: { scopes: ['private', 'group', 'channel'] },
      },
      delivery: { send: true, proactive: true, spool: true },
    },
    // ADR 0056 §1：群消息经 getChatMember 上报 creator / administrator / member，管理员 can_* 权限进 permissions。
    group: { scene: { platformStanding: { standing: true, permissions: true } } },
  },
  createAdapter: context => new TelegramAdapter(context),
});
