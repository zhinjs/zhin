import { createEndpointRuntimeState } from 'zhin.js/adapter';
import { definePlugin } from 'zhin.js';
import { permissionHostToken } from '@zhin.js/permission';
import { checkDiscordPlatformPermit } from './src/platform-permit.js';
import { discordRuntimeStateToken } from './src/discord-runtime-state.js';

export default definePlugin({
  name: 'discord',
  metadata: {
    displayName: 'Discord Gateway Adapter',
  },
  setup(context) {
    context.resources.provide(discordRuntimeStateToken, createEndpointRuntimeState());
    if (context.resources.has(permissionHostToken)) {
      const host = context.resources.use(permissionHostToken);
      return host.registerPlatform('discord', checkDiscordPlatformPermit);
    }
  },
});
