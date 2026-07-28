/**
 * `dingtalk endpoint` 命令族：由 @zhin.js/adapter 的 createEndpointCommands 套件生成。
 * commands/endpoint/ 下的 list / add / remove 直接默认导出这三项。
 */
import { createEndpointCommands } from '@zhin.js/adapter';
import { defineCommand } from '@zhin.js/command';
import { dingtalkRuntimeStateToken } from './dingtalk-runtime-state.js';

export const dingtalkEndpointCommands = createEndpointCommands({
  adapterKey: 'dingtalk',
  adapterDisplayName: 'DingTalk',
  fields: [
    { key: 'appKey', required: true, env: true, description: '钉钉 AppKey' },
    { key: 'appSecret', required: true, env: true, description: '钉钉 AppSecret' },
    { key: 'robotCode', required: true, env: true, description: '机器人 Code（出站 senderStaffId）' },
  ],
  running: (use) => use(dingtalkRuntimeStateToken).endpoints.values(),
  describeEntry: (entry) => `appKey: ${String(entry.appKey)}`,
}, defineCommand);
