/**
 * Convention entry: discover `adapters/kook/index.ts` → defineAdapter.
 * Implementation lives under `src/` (endpoint / webhook / ws / protocol).
 */
import { defineAdapter } from 'zhin.js/adapter';
import { KookAdapter } from '../../src/adapter.js';
import {
  type KookEndpointConfig,
} from '../../src/protocol.js';

export {
  KookWebhookEndpoint,
  KookWebsocketEndpoint,
} from '../../src/endpoint.js';
export type {
  KookEndpointOptions,
  KookWebhookEndpointOptions,
} from '../../src/endpoint.js';
export type { KookClientTransport } from '../../src/ws.js';

export default defineAdapter<KookEndpointConfig>({
  capabilities: ['inbound', 'outbound'],
  // KOOK 图片上传后以原生卡片保留图文混排；KMarkdown 原生消费；
  // 原生卡片按钮经 return-val 事件进入 canonical action 链路。
  profile: {
    default: {
      messaging: {
        segments: {
          outboundMedia: ['url', 'upload'],
          interactive: 'native',
          markdown: 'native',
        },
        quote: true,
        recall: {},
      },
      actions: {
        recall: { scopes: ['private', 'group', 'channel'] },
        quoteReply: { scopes: ['private', 'group', 'channel'] },
      },
      delivery: { send: true, proactive: true, spool: true },
    },
    // ADR 0056 §1：服务器频道消息按服务器主 / 管理员角色归一 standing，并上报角色与权限位。
    // 机器人自身：/v3/user/view self 的服务器角色 → 地位、角色与权限位（bot:admin、bot-permission:kick_members 等）。
    channel: { scene: { platformStanding: { standing: true, roles: true, permissions: true }, selfStanding: { standing: true, roles: true, permissions: true } } },
  },
  createAdapter: context => new KookAdapter(context),
});
