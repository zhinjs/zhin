/**
 * Convention entry: discover `adapters/napcat.ts` → defineAdapter.
 */
import { defineAdapter } from 'zhin.js/adapter';
import { messageGatewayToken, sideEventGatewayToken } from '@zhin.js/core/runtime';
import { httpHostToken } from '@zhin.js/host-http';
import { NapCatHttpEndpoint } from '../src/http-endpoint.js';
import { resolveNapCatConfig, type NapCatAdapterConfig } from '../src/protocol.js';
import { NapCatWsEndpoint } from '../src/ws-endpoint.js';
import { NapCatWssEndpoint } from '../src/wss-endpoint.js';
import { napcatRuntimeStateToken } from '../src/napcat-runtime-state.js';

export {
  NapCatHttpEndpoint,
  type NapCatHttpEndpointOptions,
} from '../src/http-endpoint.js';
export {
  NapCatWsEndpoint,
  type NapCatWsEndpointOptions,
} from '../src/ws-endpoint.js';
export {
  NapCatWssEndpoint,
  type NapCatWssEndpointOptions,
} from '../src/wss-endpoint.js';
export type { NapCatWsSocket, NapCatWsCreateOptions } from '../src/ws-types.js';

declare module '@zhin.js/core' {
  interface AdapterEndpoints {
    napcat: import('../src/ws-endpoint.js').NapCatWsEndpoint;
  }
}

export default defineAdapter<NapCatAdapterConfig>({
  capabilities: ['inbound', 'outbound'],
  operations: ['recall'],
  // OneBot file 参数原生消费 url / base64:// 媒体，file:// 本地路径由 NapCat 侧读盘；
  // 无卡片交互面，交互段降级纯文本。
  segments: {
    outboundMedia: ['url', 'base64', 'path'],
    interactive: 'text',
  },
  create(context) {
    const config = resolveNapCatConfig(context.config);
    const gateway = context.use(messageGatewayToken);
    const sideEvents = context.use(sideEventGatewayToken);
    // 注册到插件运行时状态（napcat.endpoint list 的"运行中"数据源）
    context.use(napcatRuntimeStateToken).endpoints.set(config.id, {
      id: config.id,
      mode: config.connection,
    });
    if (config.connection === 'wss') {
      return new NapCatWssEndpoint({
        id: context.id,
        gateway,
        sideEvents,
        http: context.use(httpHostToken),
        config,
      });
    }
    if (config.connection === 'http') {
      return new NapCatHttpEndpoint({
        id: context.id,
        gateway,
        sideEvents,
        http: context.use(httpHostToken),
        config,
      });
    }
    return new NapCatWsEndpoint({ id: context.id, gateway, sideEvents, config });
  },
});
