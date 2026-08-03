/**
 * `wechat-mp.endpoint` 命令族：由 @zhin.js/adapter 的 createEndpointCommands 套件生成。
 * commands/endpoint/ 下的 list / add / remove 直接默认导出这三项。
 */
import { createEndpointCommands } from '@zhin.js/adapter';
import { defineCommand } from '@zhin.js/command';
import { wechatMpRuntimeStateToken } from './wechat-mp-runtime-state.js';

export const wechatMpEndpointCommands = createEndpointCommands({
  adapterKey: 'wechat-mp',
  adapterDisplayName: 'WeChat MP',
  fields: [
    { key: 'appId', required: true, env: true, description: '公众号 AppID' },
    { key: 'appSecret', required: true, env: true, description: '公众号 AppSecret' },
    { key: 'token', required: true, env: true, description: '服务器配置 token' },
    { key: 'encodingAESKey', env: true, description: '消息加解密 key' },
  ],
  running: (use) => use(wechatMpRuntimeStateToken).endpoints.values(),
  describeEntry: (entry) => `appId: ${String(entry.appId)}`,
}, defineCommand);
