/**
 * `slack.endpoint` 命令族：由 @zhin.js/adapter 的 createEndpointCommands 套件生成。
 * commands/endpoint/ 下的 list / add / remove 直接默认导出这三项。
 */
import { createEndpointCommands } from 'zhin.js/adapter';
import { defineCommand } from 'zhin.js/command';
import { slackRuntimeStateToken } from './slack-runtime-state.js';

export const slackEndpointCommands = createEndpointCommands({
  adapterKey: 'slack',
  adapterDisplayName: 'Slack',
  fields: [
    { key: 'token', required: true, env: true, description: 'Bot User OAuth Token（xoxb-...）' },
    { key: 'signingSecret', env: true, description: '签名密钥（HTTP Events，socketMode: false 必填）' },
    { key: 'appToken', env: true, description: 'App-Level Token（xapp-...，Socket Mode）' },
  ],
  running: (use) => use(slackRuntimeStateToken).endpoints.values(),
  describeEntry: (entry) => `token: ${String(entry.token)}`,
}, defineCommand);
