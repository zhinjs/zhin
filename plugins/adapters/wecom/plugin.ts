import { createEndpointRuntimeState } from '@zhin.js/adapter';
import { definePlugin } from '@zhin.js/plugin-runtime';
import { registerWecomPlatformPermitChecker } from './src/platform-permit.js';
import { wecomRuntimeStateToken } from './src/wecom-runtime-state.js';

export default definePlugin({
  name: 'wecom',
  metadata: {
    displayName: 'WeCom (企业微信) Adapter',
  },
  setup(context) {
    // 运行中 endpoint 注册表（wecom.endpoint list 的"运行中"数据源）
    context.resources.provide(wecomRuntimeStateToken, createEndpointRuntimeState());
    return registerWecomPlatformPermitChecker();
  },
});
