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
  create(context) {
    const config = resolveQqConfig(context.config);
    const gateway = context.use(messageGatewayToken);
    // 注册到插件运行时状态（qq endpoint list 的"运行中"数据源）
    context.use(qqRuntimeStateToken).endpoints.set(config.name, {
      name: config.name,
      mode: config.mode,
    });
    if (config.mode === 'webhook' || config.mode === 'middleware') {
      return new QqHttpEndpoint({
        id: context.id,
        gateway,
        http: context.use(httpHostToken),
        config,
      });
    }
    return new QqWebsocketEndpoint({
      id: context.id,
      gateway,
      config,
    });
  },
});
