import { definePlugin, pluginConsoleRpcToken } from 'zhin.js';
import { createEmailConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'email',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  metadata: {
    displayName: 'Email Adapter',
  },
  setup(context) {
    context.resources.provide(pluginConsoleRpcToken, createEmailConsoleRpc(context.resources, () => context.config.get()));
  },
});
