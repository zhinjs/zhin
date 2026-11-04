/**
 * Convention entry: discover `adapters/onebot12/index.ts` → defineAdapter.
 */
import { defineAdapter } from 'zhin.js/adapter';
import { Onebot12Adapter } from '../../src/adapter.js';
import {
  type OneBot12EndpointConfig,
} from '../../src/protocol.js';

export { OneBot12WebhookEndpoint } from '../../src/webhook.js';
export type { OneBot12WebhookEndpointOptions } from '../../src/webhook.js';
export { OneBot12WsEndpoint } from '../../src/ws-endpoint.js';
export type { OneBot12WsEndpointOptions } from '../../src/ws-endpoint.js';
export { OneBot12WssEndpoint } from '../../src/wss-endpoint.js';
export type { OneBot12WssEndpointOptions } from '../../src/wss-endpoint.js';
export type { OneBot12WsSocket, OneBot12WsCreateOptions } from '../../src/ws-types.js';

export default defineAdapter<OneBot12EndpointConfig>({
  capabilities: ['inbound', 'outbound'],
  // 媒体段经 upload_file 物化为 file_id（spec 正式投递）；上传失败降级扩展字段透传。
  // 无卡片交互面，交互段降级纯文本。
  profile: {
    default: {
      messaging: {
        segments: {
          outboundMedia: ['url', 'path', 'base64', 'upload'],
          interactive: 'text',
        },
        quote: true,
        recall: {},
      },
      actions: {
        recall: { scopes: ['private', 'group'] },
        quoteReply: { scopes: ['private', 'group'] },
      },
      delivery: { send: true, proactive: true, spool: true },
    },
  },
  createAdapter: context => new Onebot12Adapter(context),
});
