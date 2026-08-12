/**
 * Convention entry: discover `adapters/onebot12.ts` → defineAdapter.
 */
import { defineAdapter } from '@zhin.js/adapter';
import { messageGatewayToken } from '@zhin.js/core/runtime';
import { httpHostToken } from '@zhin.js/host-http';
import { OneBot12WebhookEndpoint } from '../src/webhook.js';
import { OneBot12WsEndpoint } from '../src/ws-endpoint.js';
import { OneBot12WssEndpoint } from '../src/wss-endpoint.js';
import {
  resolveOneBot12Config,
  type OneBot12AdapterConfig,
} from '../src/protocol.js';
import { onebot12RuntimeStateToken } from '../src/onebot12-runtime-state.js';

export { OneBot12WebhookEndpoint } from '../src/webhook.js';
export type { OneBot12WebhookEndpointOptions } from '../src/webhook.js';
export { OneBot12WsEndpoint } from '../src/ws-endpoint.js';
export type { OneBot12WsEndpointOptions } from '../src/ws-endpoint.js';
export { OneBot12WssEndpoint } from '../src/wss-endpoint.js';
export type { OneBot12WssEndpointOptions } from '../src/wss-endpoint.js';
export type { OneBot12WsSocket, OneBot12WsCreateOptions } from '../src/ws-types.js';

export default defineAdapter<OneBot12AdapterConfig>({
  capabilities: ['inbound', 'outbound'],
  // 媒体段经 upload_file 物化为 file_id（spec 正式投递）；上传失败降级扩展字段透传。
  // 无卡片交互面，交互段降级纯文本。
  segments: {
    outboundMedia: ['url', 'path', 'base64', 'upload'],
    interactive: 'text',
  },
  create(context) {
    const config = resolveOneBot12Config(context.config);
    const gateway = context.use(messageGatewayToken);
    // 注册到插件运行时状态（onebot12.endpoint list 的"运行中"数据源）
    context.use(onebot12RuntimeStateToken).endpoints.set(config.id, {
      id: config.id,
      mode: config.connection,
    });
    if (config.connection === 'webhook') {
      return new OneBot12WebhookEndpoint({
        id: context.id,
        gateway,
        http: context.use(httpHostToken),
        config,
      });
    }
    if (config.connection === 'wss') {
      return new OneBot12WssEndpoint({
        id: context.id,
        gateway,
        http: context.use(httpHostToken),
        config,
      });
    }
    return new OneBot12WsEndpoint({
      id: context.id,
      gateway,
      config,
    });
  },
});
