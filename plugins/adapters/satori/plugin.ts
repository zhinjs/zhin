import { definePlugin, pluginConsoleRpcToken } from 'zhin.js';
import { createSatoriConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'satori',
  metadata: {
    displayName: 'Satori Adapter',
  },
  setup(context) {
    context.resources.provide(pluginConsoleRpcToken, createSatoriConsoleRpc(context.resources, () => context.config.get()));
  },
});
