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
    // ADR 0056 §1：群消息 group_member.role → sender.platform.standing。
    // ADR 0056 §1：发言者与机器人自身的群内地位（get_group_member_info self，供 bot:* permit）。
    group: { scene: { platformStanding: { standing: true }, selfStanding: { standing: true } } },
  },
  createAdapter: context => new MilkyAdapter(context),
});
