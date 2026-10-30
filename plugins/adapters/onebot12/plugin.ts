import { definePlugin, pluginConsoleRpcToken } from 'zhin.js';
import { createOnebot12ConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'onebot12',
  metadata: {
    displayName: 'OneBot 12 Adapter',
  },
  setup(context) {
    context.resources.provide(pluginConsoleRpcToken, createOnebot12ConsoleRpc(context.resources, () => context.config.get()));
  },
});
