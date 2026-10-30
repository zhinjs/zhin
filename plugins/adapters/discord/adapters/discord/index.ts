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
  // 媒体 url 直发或由 AttachmentBuilder 物化本地文件上传；message components 原生按钮承载交互段。
  segments: {
    outboundMedia: ['url', 'upload'],
    interactive: 'native',
    markdown: 'native',
  },
  createAdapter: context => new DiscordAdapter(context),
});
