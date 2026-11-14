import { definePlugin } from 'zhin.js';
import { createWeixinIlinkConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'weixin-ilink',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  setup(context) {
    // 运行中 endpoint 注册表（weixin-ilink endpoint list 的"运行中"数据源）
    return {
      consoleRpc: createWeixinIlinkConsoleRpc(context.resources, () => context.config.get()),
    };
  },
});
