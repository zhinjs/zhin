import { createEndpointRuntimeState } from '@zhin.js/adapter';
import { definePlugin } from '@zhin.js/plugin-runtime';
import { registerDiscordPlatformPermitChecker } from './src/platform-permit.js';
import { discordRuntimeStateToken } from './src/discord-runtime-state.js';

export default definePlugin({
  name: 'discord',
  metadata: {
    displayName: 'Discord Gateway Adapter',
  },
  setup(context) {
    // 运行中 endpoint 注册表（discord.endpoint list 的"运行中"数据源）
    context.resources.provide(discordRuntimeStateToken, createEndpointRuntimeState());
    // 平台权限门禁：guild_owner / moderate_members 等（agent 工具 platformPermit）
    return registerDiscordPlatformPermitChecker();
  },
});
