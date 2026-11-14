import { definePlugin } from 'zhin.js';
import { createWechatMpConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'wechat-mp',
  configUpdate: { featurePaths: [['nickname'], ['profile'], ['endpoints']] },
  metadata: {
    displayName: 'WeChat Official Account Adapter',
    displayNameI18n: { 'zh-CN': '微信公众号适配器', en: 'WeChat Official Account Adapter' },
  },
  setup(context) {
    // 运行中 endpoint 注册表（wechat-mp endpoint list 的"运行中"数据源）
    return {
      consoleRpc: createWechatMpConsoleRpc(context.resources, () => context.config.get()),
    };
  },
});
