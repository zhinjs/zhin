/**
 * Convention entry: discover `adapters/kook/index.ts` → defineAdapter.
 * Implementation lives under `src/` (endpoint / webhook / ws / protocol).
 */
import { defineAdapter } from 'zhin.js/adapter';
import { httpHostToken } from '@zhin.js/host-http';
import {
  KookWebhookEndpoint,
  KookWebsocketEndpoint,
} from '../../src/endpoint.js';
import {
  resolveKookConfig,
  type KookEndpointConfig,
} from '../../src/protocol.js';
import { kookRuntimeStateToken } from '../../src/kook-runtime-state.js';

export {
  KookWebhookEndpoint,
  KookWebsocketEndpoint,
} from '../../src/endpoint.js';
export type {
  KookEndpointOptions,
  KookWebhookEndpointOptions,
} from '../../src/endpoint.js';
export type { CreateKookClient, KookClientTransport } from '../../src/ws.js';

export default defineAdapter<KookEndpointConfig>({
  capabilities: ['inbound', 'outbound'],
  operations: ['recall'],
  // KOOK 图片上传后以原生卡片保留图文混排；KMarkdown 原生消费；
  // 原生卡片按钮经 return-val 事件进入 canonical action 链路。
  segments: {
    outboundMedia: ['url', 'upload'],
    interactive: 'native',
    markdown: 'native',
  },
  create(context) {
    const config = resolveKookConfig(context.config);
    // 注册到插件运行时状态（kook endpoint list 的"运行中"数据源）
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
