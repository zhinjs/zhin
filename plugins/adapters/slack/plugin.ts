import { createEndpointRuntimeState } from 'zhin.js/adapter';
import { definePlugin, pluginConsoleRpcToken } from 'zhin.js';
import { permissionHostToken } from '@zhin.js/permission';
import { checkSlackPlatformPermit } from './src/platform-permit.js';
import { slackRuntimeStateToken } from './src/slack-runtime-state.js';
import { createSlackConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'slack',
  metadata: {
    displayName: 'Slack Adapter',
  },
  setup(context) {
    context.resources.provide(slackRuntimeStateToken, createEndpointRuntimeState());
    context.resources.provide(pluginConsoleRpcToken, createSlackConsoleRpc(context.resources, () => context.config.get()));
    if (context.resources.has(permissionHostToken)) {
      const host = context.resources.use(permissionHostToken);
      return host.registerPlatform('slack', checkSlackPlatformPermit);
    }
  },
});
