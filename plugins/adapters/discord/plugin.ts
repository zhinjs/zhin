import { createEndpointRuntimeState } from 'zhin.js/adapter';
import { definePlugin, pluginConsoleRpcToken } from 'zhin.js';
import { permissionHostToken } from '@zhin.js/permission';
import { checkDiscordPlatformPermit } from './src/platform-permit.js';
import { discordRuntimeStateToken } from './src/discord-runtime-state.js';
import { createDiscordConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'discord',
  metadata: {
    displayName: 'Discord Gateway Adapter',
  },
  setup(context) {
    context.resources.provide(discordRuntimeStateToken, createEndpointRuntimeState());
    context.resources.provide(pluginConsoleRpcToken, createDiscordConsoleRpc(context.resources, () => context.config.get()));
    if (context.resources.has(permissionHostToken)) {
      const host = context.resources.use(permissionHostToken);
      return host.registerPlatform('discord', checkDiscordPlatformPermit);
    }
  },
});
