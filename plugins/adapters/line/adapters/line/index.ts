import { LineAdapter } from '../../src/adapter.js';
/**
 * Convention entry: discover `adapters/line/index.ts` → defineAdapter.
 */
import { defineAdapter } from 'zhin.js/adapter';
import {
  type LineEndpointConfig,
} from '../../src/protocol.js';

export { LineEndpoint } from '../../src/endpoint.js';
export type { LineEndpointOptions, LineFetch } from '../../src/endpoint.js';

export default defineAdapter<LineEndpointConfig>({
  capabilities: ['inbound', 'outbound'],
  // LINE Messaging API 媒体消息仅消费远程 URL；无按钮交互面，交互段降级纯文本。
  segments: {
    outboundMedia: ['url'],
    interactive: 'text',
  },
  createAdapter: context => new LineAdapter(context),
});
