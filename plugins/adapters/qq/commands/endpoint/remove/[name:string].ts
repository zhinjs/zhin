import { defineCommand } from '@zhin.js/command';
import {
  isQqEndpointOperator,
  QQ_ENDPOINT_FORBIDDEN,
  runQqEndpointRemove,
} from '../../../src/qq-endpoint-commands.js';
import { qqRuntimeStateToken } from '../../../src/qq-runtime-state.js';

export default defineCommand({
  description: '从 zhin.config.yml 的 plugins.qq.endpoints 移除指定 endpoint（重启生效）',
  execute({ config, input, params, use }) {
    if (!isQqEndpointOperator(config, input)) return QQ_ENDPOINT_FORBIDDEN;
    return runQqEndpointRemove(use(qqRuntimeStateToken), String(params.name ?? ''));
  },
});
