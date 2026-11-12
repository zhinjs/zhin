import { definePlugin } from 'zhin.js';
import { createWecomConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'wecom',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  metadata: {
    displayName: 'WeCom (企业微信) Adapter',
  },
  setup(context) {
    return {
      consoleRpc: createWecomConsoleRpc(context.resources, () => context.config.get()),
    };
  },
});
