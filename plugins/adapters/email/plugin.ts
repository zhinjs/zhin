import { createEndpointRuntimeState } from 'zhin.js/adapter';
import { definePlugin, pluginConsoleRpcToken } from 'zhin.js';
import { emailRuntimeStateToken } from './src/email-runtime-state.js';
import { createEmailConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'email',
  metadata: {
    displayName: 'Email Adapter',
  },
  setup(context) {
    context.resources.provide(emailRuntimeStateToken, createEndpointRuntimeState());
    context.resources.provide(pluginConsoleRpcToken, createEmailConsoleRpc(context.resources, () => context.config.get()));
  },
});
