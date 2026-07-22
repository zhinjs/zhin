import { defineCommand } from '@zhin.js/command';
import { runQqEndpointList } from '../../src/qq-endpoint-commands.js';
import { qqRuntimeStateToken } from '../../src/qq-runtime-state.js';

export default defineCommand({
  description: '列出 QQ endpoints（运行中 + zhin.config.yml 配置）',
  execute({ use }) {
    return runQqEndpointList(use(qqRuntimeStateToken));
  },
});
