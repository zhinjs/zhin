import { definePlugin, pluginConsoleRpcToken } from 'zhin.js';
import { createMilkyConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'milky',
  metadata: {
    displayName: 'Milky Adapter',
  },
  setup(context) {
    context.resources.provide(pluginConsoleRpcToken, createMilkyConsoleRpc(context.resources, () => context.config.get()));
  },
});
