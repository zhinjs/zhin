/**
 * Convention entry: discover `adapters/onebot11.ts` → defineAdapter.
 */
import { defineAdapter } from '@zhin.js/adapter';
import { messageGatewayToken } from '@zhin.js/core/runtime';
import { httpHostToken } from '@zhin.js/host-http';
import { OneBot11WsEndpoint } from '../src/ws-endpoint.js';
import { OneBot11WssEndpoint } from '../src/wss-endpoint.js';
import {
  resolveOneBot11Config,
  type OneBot11AdapterConfig,
} from '../src/protocol.js';
import { onebot11RuntimeStateToken } from '../src/onebot11-runtime-state.js';

export { OneBot11WsEndpoint } from '../src/ws-endpoint.js';
export type { OneBot11WsEndpointOptions } from '../src/ws-endpoint.js';
export { OneBot11WssEndpoint } from '../src/wss-endpoint.js';
export type { OneBot11WssEndpointOptions } from '../src/wss-endpoint.js';
export type { OneBot11WsSocket, OneBot11WsCreateOptions } from '../src/ws-types.js';

export default defineAdapter<OneBot11AdapterConfig>({
  capabilities: ['inbound', 'outbound'],
  // OneBot file 参数原生消费 url / base64:// 媒体；无卡片交互面，交互段降级纯文本。
  segments: {
    outboundMedia: ['url', 'base64'],
    interactive: 'text',
  },
  create(context) {
    const config = resolveOneBot11Config(context.config);
    const gateway = context.use(messageGatewayToken);
    // 注册到插件运行时状态（onebot11.endpoint list 的"运行中"数据源）
    context.use(onebot11RuntimeStateToken).endpoints.set(config.id, {
      id: config.id,
      mode: config.connection,
    });
    if (config.connection === 'wss') {
      return new OneBot11WssEndpoint({
        id: context.id,
        gateway,
        http: context.use(httpHostToken),
        config,
      });
    }
    return new OneBot11WsEndpoint({
      id: context.id,
      gateway,
      config,
    });
  },
});
