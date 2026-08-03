import { createEndpointRuntimeState } from '@zhin.js/adapter';
import { definePlugin } from '@zhin.js/plugin-runtime';
import { registerDingtalkPlatformPermitChecker } from './src/platform-permit.js';
import { dingtalkRuntimeStateToken } from './src/dingtalk-runtime-state.js';

export default definePlugin({
  name: 'dingtalk',
  metadata: {
    displayName: 'DingTalk (钉钉) Adapter',
  },
  setup(context) {
    // 运行中 endpoint 注册表（dingtalk.endpoint list 的"运行中"数据源）
    context.resources.provide(dingtalkRuntimeStateToken, createEndpointRuntimeState());
    return registerDingtalkPlatformPermitChecker();
  },
});
