/**
 * Convention entry: discover `adapters/kook.ts` → defineAdapter.
 * Implementation lives under `src/` (endpoint / webhook / ws / protocol).
 */
import { defineAdapter } from 'zhin.js/adapter';
import { httpHostToken } from '@zhin.js/host-http';
import {
  KookWebhookEndpoint,
  KookWebsocketEndpoint,
} from '../src/endpoint.js';
import {
  resolveKookConfig,
  type KookAdapterConfig,
} from '../src/protocol.js';
import { kookRuntimeStateToken } from '../src/kook-runtime-state.js';

export {
  KookWebhookEndpoint,
  KookWebsocketEndpoint,
} from '../src/endpoint.js';
export type {
  KookEndpointOptions,
  KookWebhookEndpointOptions,
} from '../src/endpoint.js';
export type { CreateKookClient, KookClientTransport } from '../src/ws.js';

export default defineAdapter<KookAdapterConfig>({
  capabilities: ['inbound', 'outbound'],
  operations: ['recall'],
  // KOOK 图片消息消费远程 URL；KMarkdown 由 endpoint codec 原生消费；
  // 无按钮交互面，交互段降级纯文本。
  segments: {
    outboundMedia: ['url'],
    interactive: 'text',
    markdown: 'native',
  },
  create(context) {
    const config = resolveKookConfig(context.config);
    // 注册到插件运行时状态（kook.endpoint list 的"运行中"数据源）
    context.use(kookRuntimeStateToken).endpoints.set(config.id, {
      id: config.id,
      mode: config.connection,
    });
    if (config.connection === 'webhook') {
      return new KookWebhookEndpoint({
        id: context.id,
        http: context.use(httpHostToken),
        config,
      });
    }
    return new KookWebsocketEndpoint({
      id: context.id,
      config,
    });
  },
});
