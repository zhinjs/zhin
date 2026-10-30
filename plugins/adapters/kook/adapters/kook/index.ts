/**
 * Convention entry: discover `adapters/kook/index.ts` → defineAdapter.
 * Implementation lives under `src/` (endpoint / webhook / ws / protocol).
 */
import { defineAdapter } from 'zhin.js/adapter';
import { KookAdapter } from '../../src/adapter.js';
import {
  type KookEndpointConfig,
} from '../../src/protocol.js';

export {
  KookWebhookEndpoint,
  KookWebsocketEndpoint,
} from '../../src/endpoint.js';
export type {
  KookEndpointOptions,
  KookWebhookEndpointOptions,
} from '../../src/endpoint.js';
export type { KookClientTransport } from '../../src/ws.js';

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
  createAdapter: context => new KookAdapter(context),
});
