import { definePlugin } from 'zhin.js';
import { createSatoriConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'satori',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  metadata: {
    displayName: 'Satori Adapter',
    displayNameI18n: { 'zh-CN': 'Satori 适配器', en: 'Satori Adapter' },
  },
  setup(context) {
    return {
      consoleRpc: createSatoriConsoleRpc(context.resources, () => context.config.get()),
    };
  },
});
