import { defineCommand } from '@zhin.js/command';
import {
  extractQqCommandReply,
  isQqEndpointOperator,
  QQ_ENDPOINT_FORBIDDEN,
  runQqEndpointAdd,
} from '../../../src/qq-endpoint-commands.js';
import { qqRuntimeStateToken } from '../../../src/qq-runtime-state.js';

export default defineCommand({
  description: '手机 QQ 扫码绑定机器人，凭据写入 .env 并追加到 zhin.config.yml（重启生效）',
  execute({ config, input, params, use }) {
    if (!isQqEndpointOperator(config, input)) return QQ_ENDPOINT_FORBIDDEN;
    const name = typeof params.name === 'string' && params.name.trim() ? params.name.trim() : undefined;
    return runQqEndpointAdd(
      use(qqRuntimeStateToken),
      name,
      extractQqCommandReply(input),
    );
  },
});
