/**
 * `dingtalk endpoint` 命令族：由 @zhin.js/adapter 的 createEndpointCommands 套件生成。
 * commands/dingtalk/endpoint/ 下的 list / add / remove 直接默认导出这三项。
 */
import { createEndpointCommands } from 'zhin.js/adapter';
import { defineCommand } from 'zhin.js/command';

export const dingtalkEndpointCommands = createEndpointCommands({
  adapterKey: 'dingtalk',
  adapterDisplayName: 'DingTalk',
  fields: [
    { key: 'appKey', required: true, env: true, description: '钉钉 AppKey', descriptionI18n: { en: "DingTalk app key" } },
    { key: 'appSecret', required: true, env: true, description: '钉钉 AppSecret', descriptionI18n: { en: "DingTalk app secret" } },
    { key: 'robotCode', env: true, description: '机器人 Code（出站 senderStaffId）', descriptionI18n: { en: "Robot code (outbound senderStaffId)" } },
  ],
  describeEntry: (entry) => `appKey: ${String(entry.appKey)}`,
}, defineCommand);
