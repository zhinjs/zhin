/**
 * Convention entry: discover `adapters/discord/index.ts` → defineAdapter.
 */
import { defineAdapter } from 'zhin.js/adapter';
import { DiscordAdapter } from '../../src/adapter.js';
import {
  type DiscordEndpointConfig,
} from '../../src/protocol.js';

export {
  DiscordGatewayEndpoint,
  DiscordInteractionsEndpoint,
} from '../../src/endpoint.js';
export type {
  DiscordClientTransport,
  DiscordEndpointOptions,
  DiscordInteractionsEndpointOptions,
} from '../../src/endpoint.js';

export default defineAdapter<DiscordEndpointConfig>({
  capabilities: ['inbound', 'outbound'],
  operations: (context) => context.config.connection === 'interactions'
    ? ['recall']
    : ['recall', 'reaction'],
  // 反应（reaction）留在上面的 operations：profile 对 Adapter 静态，而 interactions 传输不能加反应。
  // 媒体 url 直发或由 AttachmentBuilder 物化本地文件上传；message components 原生按钮承载交互段。
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
      // Activity feedback prefers a reaction; the interactions transport has none, so it degrades to a status message.
      feedback: { mode: 'reaction' },
      delivery: { send: true, proactive: true, spool: true },
    },
    // ADR 0056 §1：服务器频道消息上报群主 / 管理员 / 成员、身份组与权限位。
    // 机器人自身：guild.members.me 的身份组与频道权限（bot:admin、bot-permission:manage_roles 等）。
    channel: { scene: { platformStanding: { standing: true, roles: true, permissions: true }, selfStanding: { standing: true, roles: true, permissions: true } } },
  },
  createAdapter: context => new DiscordAdapter(context),
});
