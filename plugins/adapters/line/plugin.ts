import { definePlugin } from 'zhin.js';
import { createLineConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'line',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  metadata: {
    displayName: 'LINE Messaging API Adapter',
  },
  setup(context) {
    // 运行中 endpoint 注册表（line endpoint list 的"运行中"数据源）
    return {
      consoleRpc: createLineConsoleRpc(context.resources, () => context.config.get()),
    };
  },
});
