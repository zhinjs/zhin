/**
 * Convention entry: discover `adapters/telegram.ts` → defineAdapter.
 */
import { defineAdapter } from '@zhin.js/adapter';
import { messageGatewayToken } from '@zhin.js/core/runtime';
import { httpHostToken } from '@zhin.js/host-http';
import { TelegramEndpoint } from '../src/endpoint.js';
import {
  resolveTelegramConfig,
  type TelegramAdapterConfig,
} from '../src/protocol.js';
import { telegramRuntimeStateToken } from '../src/telegram-runtime-state.js';

export { TelegramEndpoint } from '../src/endpoint.js';
export type { TelegramEndpointOptions, TelegramFetch } from '../src/endpoint.js';

export default defineAdapter<TelegramAdapterConfig>({
  capabilities: ['inbound', 'outbound'],
  // 媒体 url / file_id 直发，base64 / 本地路径经 multipart attach:// 上传物化；
  // inline keyboard 原生按钮承载交互段。
  segments: {
    outboundMedia: ['url', 'upload'],
    interactive: 'native',
  },
  create(context) {
    const config = resolveTelegramConfig(context.config);
    // 注册到插件运行时状态（telegram.endpoint list 的"运行中"数据源）
    context.use(telegramRuntimeStateToken).endpoints.set(config.name, {
      name: config.name,
      mode: config.mode,
    });
    return new TelegramEndpoint({
      id: context.id,
      gateway: context.use(messageGatewayToken),
      config,
      http: config.mode === 'webhook' ? context.use(httpHostToken) : undefined,
    });
  },
});
