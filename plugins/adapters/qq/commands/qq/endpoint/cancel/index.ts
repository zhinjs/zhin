import { endpointCommandForbidden } from 'zhin.js/adapter';
import { defineCommand } from 'zhin.js/command';
import {
  isQqEndpointOperator,
  qqRuntimeStateToken,
  runQqEndpointCancel,
} from '../definition.js';

export default defineCommand({
  description: '取消进行中的 QQ 扫码绑定或公域/私域选择', descriptionI18n: { en: "Cancel an active QQ QR binding or public/private-domain selection" },
  execute({ config, input, use, locale }) {
    if (!isQqEndpointOperator(config, input)) return endpointCommandForbidden('QQ', locale);
    return runQqEndpointCancel(use(qqRuntimeStateToken), locale);
  },
});
