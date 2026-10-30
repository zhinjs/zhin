import { defineCommand } from 'zhin.js/command';
import {
  icqqLoginControls,
  icqqLoginForbidden,
  isIcqqLoginOperator,
  pickIcqqLoginControl,
} from '../definition.js';

export default defineCommand({
  description: '确认已完成 ICQQ 扫码登录',
  descriptionI18n: { en: 'Confirm the ICQQ QR login was scanned' },
  async execute({ args, config, input, project, owner }) {
    if (!isIcqqLoginOperator(config, input)) return icqqLoginForbidden();
    const picked = pickIcqqLoginControl(icqqLoginControls({ project, owner }), args[0]);
    if (!picked.control) return picked.text ?? 'ICQQ 适配器还没有启动';
    const task = picked.control.pending().find((item) => item.type === 'qrcode' || item.type === 'auth');
    if (!task) return '当前没有等待确认的扫码登录；发送 `icqq login qr` 获取二维码。';
    if (!picked.control.submit(task.id, 'ok')) return '登录待办已失效，请重新发送 `icqq login qr`。';
    return `已提交 ICQQ ${task.endpointKey} 的扫码确认，正在登录。`;
  },
});
