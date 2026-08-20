/**
 * `github.endpoint` 命令族：由 @zhin.js/adapter 的 createEndpointCommands 套件生成。
 * commands/endpoint/ 下的 list / add / remove 直接默认导出这三项。
 *
 * 字段说明：private_key 内容长且含换行，不适合 kv 直传——运行时（gh-client
 * resolvePrivateKey）本就支持 PEM 内容或文件路径，故 add 采用**内联路径**形式：
 * `github.endpoint add mybot app_id=123456 private_key=./data/mybot.pem`。
 */
import { createEndpointCommands } from 'zhin.js/adapter';
import { defineCommand } from 'zhin.js/command';
import { githubRuntimeStateToken } from './github-runtime-state.js';

export const githubEndpointCommands = createEndpointCommands({
  adapterKey: 'github',
  adapterDisplayName: 'GitHub',
  fields: [
    { key: 'app_id', required: true, env: true, description: 'GitHub App ID' },
    { key: 'private_key', required: true, description: 'PEM 文件路径（推荐，如 ./data/xxx.pem）或 PEM 内容' },
    { key: 'webhook_secret', env: true, description: 'webhook 签名密钥（不配则 API-only）' },
  ],
  running: (use) => use(githubRuntimeStateToken).endpoints.values(),
  describeEntry: (entry) => `app_id: ${String(entry.app_id ?? entry.appId)}`,
}, defineCommand);
