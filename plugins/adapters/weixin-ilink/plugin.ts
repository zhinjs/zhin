import { createEndpointRuntimeState } from '@zhin.js/adapter';
import { definePlugin } from '@zhin.js/plugin-runtime';
import { weixinIlinkRuntimeStateToken } from './src/weixin-ilink-runtime-state.js';

export default definePlugin({
  name: 'weixin-ilink',
  metadata: {
    displayName: 'Weixin iLink Adapter',
  },
  setup(context) {
    // 运行中 endpoint 注册表（weixin-ilink.endpoint list 的"运行中"数据源）
    context.resources.provide(weixinIlinkRuntimeStateToken, createEndpointRuntimeState());
  },
});
