/**
 * Convention entry: discover `adapters/line.ts` → defineAdapter.
 */
import { defineAdapter } from 'zhin.js/adapter';
import { httpHostToken } from '@zhin.js/host-http';
import { LineEndpoint } from '../src/endpoint.js';
import {
  resolveLineConfig,
  type LineAdapterConfig,
} from '../src/protocol.js';
import { lineRuntimeStateToken } from '../src/line-runtime-state.js';

export { LineEndpoint } from '../src/endpoint.js';
export type { LineEndpointOptions, LineFetch } from '../src/endpoint.js';

export default defineAdapter<LineAdapterConfig>({
  capabilities: ['inbound', 'outbound'],
  // LINE Messaging API 媒体消息仅消费远程 URL；无按钮交互面，交互段降级纯文本。
  segments: {
    outboundMedia: ['url'],
    interactive: 'text',
  },
  create(context) {
    const config = resolveLineConfig(context.config);
    // 注册到插件运行时状态（line.endpoint list 的"运行中"数据源）
    context.use(lineRuntimeStateToken).endpoints.set(config.id, {
      id: config.id,
      mode: 'webhook',
    });
    return new LineEndpoint({
      id: context.id,
      http: context.use(httpHostToken),
      config,
    });
  },
});
