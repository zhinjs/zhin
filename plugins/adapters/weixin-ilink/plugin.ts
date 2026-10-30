import { definePlugin, pluginConsoleRpcToken } from 'zhin.js';
import { createWeixinIlinkConsoleRpc } from './src/console.js';

export default definePlugin({
  name: 'weixin-ilink',
  metadata: {
    displayName: 'Weixin iLink Adapter',
  },
  setup(context) {
    // 运行中 endpoint 注册表（weixin-ilink endpoint list 的"运行中"数据源）
    context.resources.provide(pluginConsoleRpcToken, createWeixinIlinkConsoleRpc(context.resources, () => context.config.get()));
  },
});
