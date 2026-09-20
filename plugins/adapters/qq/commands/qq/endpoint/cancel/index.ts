import { defineCommand } from 'zhin.js/command';
import {
  isQqEndpointOperator,
  QQ_ENDPOINT_FORBIDDEN,
  qqRuntimeStateToken,
  runQqEndpointCancel,
} from '../definition.js';

export default defineCommand({
  description: '取消进行中的 QQ 扫码绑定或公域/私域选择',
  execute({ config, input, use }) {
    if (!isQqEndpointOperator(config, input)) return QQ_ENDPOINT_FORBIDDEN;
    return runQqEndpointCancel(use(qqRuntimeStateToken));
  },
});
