/**
 * Convention entry: discover `adapters/qq/index.ts` → defineAdapter.
 */
import { createAdapterOutageNotifier, defineAdapter } from 'zhin.js/adapter';
import { outboundHostToken } from 'zhin.js';
import { httpHostToken } from '@zhin.js/host-http';
import { QqHttpEndpoint, QqWebsocketEndpoint } from '../../src/endpoint.js';
import {
  resolveQqConfig,
  type QqEndpointConfig,
} from '../../src/protocol.js';
import { qqRuntimeStateToken } from '../../src/qq-runtime-state.js';

export {
  QqHttpEndpoint,
  QqWebsocketEndpoint,
} from '../../src/endpoint.js';
export type {
  CreateQqBot,
  CreateQqHttpBot,
  QqBotTransport,
  QqEndpointOptions,
  QqHttpBotTransport,
  QqHttpEndpointOptions,
} from '../../src/endpoint.js';

declare module '@zhin.js/core' {
  interface AdapterEndpoints {
    qq: import('../../src/endpoint.js').QqWebsocketEndpoint;
  }
}

export default defineAdapter<QqEndpointConfig>({
  capabilities: ['inbound', 'outbound'],
  operations: ['recall', 'reaction'],
  // 媒体 url 直发，base64/path 由 SDK formatMediaData 物化走 /files 上传；
  // markdown/keyboard 原生按钮承载交互段。
  segments: {
    supported: ['text', 'mention', 'image', 'audio', 'video', 'file', 'reply', 'markdown', 'keyboard'],
    markdown: 'native',
    outboundMedia: ['url', 'upload'],
    interactive: 'native',
  },
  create(context) {
    const config = resolveQqConfig(context.config);
    // 注册到插件运行时状态（qq endpoint list 的"运行中"数据源）
    const state = context.use(qqRuntimeStateToken);
    state.endpoints.set(config.id, {
      id: config.id,
      mode: config.mode,
    });
    // 正向判 websocket：TS 对 `mode === 'webhook' || mode === 'middleware'` 的
    // 否定分支不做联合消减（多字面量判别式），反向写会让 config 窄化失败。
    const outbound = context.has?.(outboundHostToken) ? context.use(outboundHostToken) : undefined;
    const notifier = createAdapterOutageNotifier(outbound, config.notify);
    const endpoint = config.mode === 'websocket'
      ? new QqWebsocketEndpoint({
        id: context.id,
        config,
        notifier,
      })
      : new QqHttpEndpoint({
        id: context.id,
        http: context.use(httpHostToken),
        config,
        notifier,
      });
    // 运行状态表只增不减：stop 时同步摘除，避免 stop 后 qq endpoint list 仍显示运行中。
    const stopEndpoint = endpoint.stop.bind(endpoint);
    endpoint.stop = async () => {
      state.endpoints.delete(config.id);
      await stopEndpoint();
    };
    return endpoint;
  },
});
