/**
 * Convention entry: discover `adapters/milky.ts` → defineAdapter.
 */
import { defineAdapter } from '@zhin.js/adapter';
import { messageGatewayToken } from '@zhin.js/core/runtime';
import { httpHostToken } from '@zhin.js/host-http';
import {
  MilkySseEndpoint,
  MilkyWebhookEndpoint,
  MilkyWssEndpoint,
  MilkyWsEndpoint,
} from '../src/endpoint.js';
import {
  resolveMilkyConfig,
  type MilkyAdapterConfig,
} from '../src/protocol.js';
import { milkyRuntimeStateToken } from '../src/milky-runtime-state.js';

export {
  MilkySseEndpoint,
  MilkyWebhookEndpoint,
  MilkyWssEndpoint,
  MilkyWsEndpoint,
} from '../src/endpoint.js';
export type {
  CreateMilkySseStream,
  MilkySseEndpointOptions,
  MilkyWebhookEndpointOptions,
  MilkyWssEndpointOptions,
  MilkyWsEndpointOptions,
  MilkyWsCreateOptions,
  MilkyWsSocket,
} from '../src/endpoint.js';

export default defineAdapter<MilkyAdapterConfig>({
  capabilities: ['inbound', 'outbound'],
  create(context) {
    const config = resolveMilkyConfig(context.config);
    const gateway = context.use(messageGatewayToken);
    // 注册到插件运行时状态（milky endpoint list 的"运行中"数据源）
    context.use(milkyRuntimeStateToken).endpoints.set(config.name, {
      name: config.name,
      mode: config.connection,
    });
    if (config.connection === 'webhook') {
      return new MilkyWebhookEndpoint({
        id: context.id,
        gateway,
        http: context.use(httpHostToken),
        config,
      });
    }
    if (config.connection === 'wss') {
      return new MilkyWssEndpoint({
        id: context.id,
        gateway,
        http: context.use(httpHostToken),
        config,
      });
    }
    if (config.connection === 'sse') {
      return new MilkySseEndpoint({
        id: context.id,
        gateway,
        config,
      });
    }
    return new MilkyWsEndpoint({
      id: context.id,
      gateway,
      config,
    });
  },
});
