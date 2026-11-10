/**
 * Convention entry: discover `adapters/satori/index.ts` → defineAdapter.
 */
import { defineAdapter } from 'zhin.js/adapter';
import { SatoriAdapter } from '../../src/adapter.js';
import {
  type SatoriEndpointConfig,
} from '../../src/protocol.js';

export { SatoriWebhookEndpoint, SatoriWsEndpoint } from '../../src/endpoint.js';
export type {
  CreateSatoriWebSocket,
  SatoriApiCaller,
  SatoriWebhookEndpointOptions,
  SatoriWsEndpointOptions,
  SatoriWsSocket,
} from '../../src/endpoint.js';

export default defineAdapter<SatoriEndpointConfig>({
  capabilities: ['inbound', 'outbound'],
  // Satori 协议 img/file 元素消费 url 与 base64 内联数据；无卡片交互面，交互段降级纯文本。
  profile: {
    default: {
      messaging: {
        segments: {
          outboundMedia: ['url', 'base64'],
          interactive: 'text',
        },
        recall: {},
        reaction: {},
      },
      actions: {
        recall: { scopes: ['private', 'group', 'channel'] },
        reaction: {
          scopes: ['private', 'group', 'channel'],
          params: { cancellable: true },
        },
      },
      delivery: { send: true, spool: true },
    },
  },
  createAdapter: context => new SatoriAdapter(context),
});
