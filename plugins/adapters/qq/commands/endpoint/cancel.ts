import { defineCommand } from '@zhin.js/command';
import {
  isQqEndpointOperator,
  QQ_ENDPOINT_FORBIDDEN,
  runQqEndpointCancel,
} from '../../src/qq-endpoint-commands.js';
import { qqRuntimeStateToken } from '../../src/qq-runtime-state.js';

export default defineCommand({
  description: '取消进行中的 QQ 扫码绑定流程',
  execute({ config, input, use }) {
    if (!isQqEndpointOperator(config, input)) return QQ_ENDPOINT_FORBIDDEN;
    return runQqEndpointCancel(use(qqRuntimeStateToken));
  },
});
