import { defineCommand } from 'zhin.js/command';
import {
  icqqLoginControls,
  icqqLoginForbidden,
  isIcqqLoginOperator,
  pickIcqqLoginControl,
} from '../definition.js';

export default defineCommand({
  description: '重新触发 ICQQ 登录',
  descriptionI18n: { en: 'Trigger an ICQQ login attempt again' },
  async execute({ args, config, input, project, owner }) {
    if (!isIcqqLoginOperator(config, input)) return icqqLoginForbidden();
    const picked = pickIcqqLoginControl(icqqLoginControls({ project, owner }), args[0]);
    if (!picked.control) return picked.text ?? 'ICQQ 适配器还没有启动';
    try {
      await picked.control.relogin();
      return `已触发 ICQQ ${picked.control.endpointId} 重新登录；需要扫码时发送 \`icqq login qr\`。`;
    } catch {
      return `ICQQ ${picked.control.endpointId} 重新登录失败，请稍后重试或查看日志。`;
    }
  },
});
