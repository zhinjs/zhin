import { definePlugin } from 'zhin.js';
import { createMilkyConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'milky',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  metadata: {
    displayName: 'Milky Adapter',
    displayNameI18n: { 'zh-CN': 'Milky 适配器', en: 'Milky Adapter' },
  },
  setup(context) {
    return {
      consoleRpc: createMilkyConsoleRpc(context.resources, () => context.config.get()),
    };
  },
});
