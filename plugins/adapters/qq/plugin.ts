import { definePlugin } from 'zhin.js';
import { createQqRuntimeState, qqRuntimeStateStore } from './src/qq-runtime-state.js';
import { createQqConsoleRpc } from './src/console.js';
import { cancelQqConsoleBind } from './src/qq-console.js';

export default definePlugin({
  name: 'qq',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  metadata: {
    displayName: 'QQ Official WebSocket Adapter',
  },
  setup(context) {
    const state = qqRuntimeStateStore.provide(context, createQqRuntimeState());
    return {
      consoleRpc: createQqConsoleRpc(state, () => context.config.get()),
      dispose: () => { cancelQqConsoleBind(state); },
    };
  },
});
