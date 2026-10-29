/**
 * Convention entry: discover `adapters/telegram/index.ts` → defineAdapter.
 */
import { defineAdapter } from 'zhin.js/adapter';
import { httpHostToken } from '@zhin.js/host-http';
import { TelegramEndpoint } from '../../src/endpoint.js';
import {
  resolveTelegramConfig,
  type TelegramEndpointConfig,
} from '../../src/protocol.js';
import { telegramRuntimeStateToken } from '../../src/telegram-runtime-state.js';

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
      delivery: { send: true, proactive: true },
    },
  },
  create(context) {
    const config = resolveTelegramConfig(context.config);
    // 注册到插件运行时状态（telegram endpoint list 的"运行中"数据源）
    context.use(telegramRuntimeStateToken).endpoints.set(config.id, {
      id: config.id,
      mode: config.mode,
    });
    return new TelegramEndpoint({
      id: context.id,
      config,
      http: config.mode === 'webhook' ? context.use(httpHostToken) : undefined,
    });
  },
});
