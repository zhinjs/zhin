/**
 * Convention entry: discover `adapters/milky/index.ts` → defineAdapter.
 */
import { defineAdapter } from 'zhin.js/adapter';
import { MilkyAdapter } from '../../src/adapter.js';
import {
  type MilkyEndpointConfig,
} from '../../src/protocol.js';

export {
  MilkySseEndpoint,
  MilkyWebhookEndpoint,
  MilkyWssEndpoint,
  MilkyWsEndpoint,
} from '../../src/endpoint.js';
export type {
  CreateMilkySseStream,
  MilkySseEndpointOptions,
  MilkyWebhookEndpointOptions,
  MilkyWssEndpointOptions,
  MilkyWsEndpointOptions,
  MilkyWsCreateOptions,
  MilkyWsSocket,
} from '../../src/endpoint.js';

export default defineAdapter<MilkyEndpointConfig>({
  capabilities: ['inbound', 'outbound'],
  // Milky 协议资源 uri 消费 http(s):// 与 base64:// 形式；无卡片交互面，交互段降级纯文本。
  profile: {
    default: {
      messaging: {
        segments: {
          outboundMedia: ['url', 'base64'],
          interactive: 'text',
        },
        quote: true,
        recall: {},
      },
      actions: {
        recall: { scopes: ['private', 'group'] },
        quoteReply: { scopes: ['private', 'group'] },
      },
      delivery: { send: true, proactive: true, spool: true },
    },
  },
  createAdapter: context => new MilkyAdapter(context),
});
