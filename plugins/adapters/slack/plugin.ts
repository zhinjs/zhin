import { createEndpointRuntimeState } from '@zhin.js/adapter';
import { definePlugin } from '@zhin.js/plugin-runtime';
import { registerSlackPlatformPermitChecker } from './src/platform-permit.js';
import { slackRuntimeStateToken } from './src/slack-runtime-state.js';

export default definePlugin({
  name: 'slack',
  metadata: {
    displayName: 'Slack Adapter',
  },
  setup(context) {
    // 运行中 endpoint 注册表（slack endpoint list 的"运行中"数据源）
    context.resources.provide(slackRuntimeStateToken, createEndpointRuntimeState());
    // 平台权限门禁：workspace_owner / channel_manager 等（agent 工具 platformPermit）
    return registerSlackPlatformPermitChecker();
  },
});
