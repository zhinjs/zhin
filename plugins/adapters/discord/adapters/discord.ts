/**
 * Convention entry: discover `adapters/discord.ts` → defineAdapter.
 */
import { defineAdapter } from '@zhin.js/adapter';
import { messageGatewayToken } from '@zhin.js/core/runtime';
import { httpHostToken } from '@zhin.js/host-http';
import {
  DiscordGatewayEndpoint,
  DiscordInteractionsEndpoint,
} from '../src/endpoint.js';
import {
  resolveDiscordConfig,
  type DiscordAdapterConfig,
} from '../src/protocol.js';
import { discordRuntimeStateToken } from '../src/discord-runtime-state.js';

export {
  DiscordGatewayEndpoint,
  DiscordInteractionsEndpoint,
} from '../src/endpoint.js';
export type {
  CreateDiscordClient,
  DiscordClientTransport,
  DiscordEndpointOptions,
  DiscordInteractionsEndpointOptions,
} from '../src/endpoint.js';

export default defineAdapter<DiscordAdapterConfig>({
  capabilities: ['inbound', 'outbound'],
  operations: ['recall'],
  // 媒体 url 直发或由 AttachmentBuilder 物化本地文件上传；message components 原生按钮承载交互段。
  segments: {
    outboundMedia: ['url', 'upload'],
    interactive: 'native',
  },
  create(context) {
    const config = resolveDiscordConfig(context.config);
    const gateway = context.use(messageGatewayToken);
    // 注册到插件运行时状态（discord.endpoint list 的"运行中"数据源）
    context.use(discordRuntimeStateToken).endpoints.set(config.name, {
      name: config.name,
      mode: config.connection,
    });
    if (config.connection === 'interactions') {
      return new DiscordInteractionsEndpoint({
        id: context.id,
        gateway,
        http: context.use(httpHostToken),
        config,
      });
    }
    return new DiscordGatewayEndpoint({
      id: context.id,
      gateway,
      config,
    });
  },
});
