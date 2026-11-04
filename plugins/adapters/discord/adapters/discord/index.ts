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
  },
  createAdapter: context => new DiscordAdapter(context),
});
