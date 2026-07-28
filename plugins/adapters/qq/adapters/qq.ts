/**
 * Convention entry: discover `adapters/qq.ts` → defineAdapter.
 */
import { defineAdapter } from '@zhin.js/adapter';
import { messageGatewayToken } from '@zhin.js/core/runtime';
import { httpHostToken } from '@zhin.js/host-http';
import { QqHttpEndpoint, QqWebsocketEndpoint } from '../src/endpoint.js';
import {
  resolveQqConfig,
  type QqAdapterConfig,
} from '../src/protocol.js';
import { qqRuntimeStateToken } from '../src/qq-runtime-state.js';

export {
  QqHttpEndpoint,
  QqWebsocketEndpoint,
} from '../src/endpoint.js';
export type {
  CreateQqBot,
  CreateQqHttpBot,
  QqBotTransport,
  QqEndpointOptions,
  QqHttpBotTransport,
  QqHttpEndpointOptions,
} from '../src/endpoint.js';

export default defineAdapter<QqAdapterConfig>({
  capabilities: ['inbound', 'outbound'],
  // 媒体 url 直发，base64/path 由 SDK formatMediaData 物化走 /files 上传；
  // markdown/keyboard 原生按钮承载交互段。
  segments: {
    outboundMedia: ['url', 'upload'],
    interactive: 'native',
  },
  create(context) {
    const config = resolveQqConfig(context.config);
    const gateway = context.use(messageGatewayToken);
    // 注册到插件运行时状态（qq endpoint list 的"运行中"数据源）
    const state = context.use(qqRuntimeStateToken);
    state.endpoints.set(config.name, {
      name: config.name,
      mode: config.mode,
    });
    const endpoint = (config.mode === 'webhook' || config.mode === 'middleware')
      ? new QqHttpEndpoint({
        id: context.id,
        gateway,
        http: context.use(httpHostToken),
        config,
      })
      : new QqWebsocketEndpoint({
        id: context.id,
        gateway,
        config,
      });
    // 运行状态表只增不减：stop 时同步摘除，避免 stop 后 endpoint list 仍显示运行中。
    const stopEndpoint = endpoint.stop.bind(endpoint);
    endpoint.stop = async () => {
      state.endpoints.delete(config.name);
      await stopEndpoint();
    };
    return endpoint;
  },
});
