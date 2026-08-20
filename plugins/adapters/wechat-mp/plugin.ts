import { createEndpointRuntimeState } from 'zhin.js/adapter';
import { definePlugin } from 'zhin.js/plugin-runtime';
import { wechatMpRuntimeStateToken } from './src/wechat-mp-runtime-state.js';

export default definePlugin({
  name: 'wechat-mp',
  metadata: {
    displayName: 'WeChat Official Account Adapter',
  },
  setup(context) {
    // 运行中 endpoint 注册表（wechat-mp.endpoint list 的"运行中"数据源）
    context.resources.provide(wechatMpRuntimeStateToken, createEndpointRuntimeState());
  },
});
