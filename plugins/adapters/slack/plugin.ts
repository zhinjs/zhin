import { createEndpointRuntimeState } from 'zhin.js/adapter';
import { definePlugin } from 'zhin.js/plugin-runtime';
import { permissionHostToken } from '@zhin.js/permission';
import { checkSlackPlatformPermit } from './src/platform-permit.js';
import { slackRuntimeStateToken } from './src/slack-runtime-state.js';

export default definePlugin({
  name: 'slack',
  metadata: {
    displayName: 'Slack Adapter',
  },
  setup(context) {
    context.resources.provide(slackRuntimeStateToken, createEndpointRuntimeState());
    if (context.resources.has(permissionHostToken)) {
      const host = context.resources.use(permissionHostToken);
      return host.registerPlatform('slack', checkSlackPlatformPermit);
    }
  },
});
