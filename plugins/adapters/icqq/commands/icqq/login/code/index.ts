import { defineCommand } from 'zhin.js/command';
import {
  icqqLoginControls,
  icqqLoginForbidden,
  isIcqqLoginOperator,
  pendingTaskLabel,
  pickIcqqLoginControl,
} from '../definition.js';

export default defineCommand({
  description: '提交 ICQQ 滑块/短信/设备验证内容',
  descriptionI18n: { en: 'Submit an ICQQ slider, SMS or device verification value' },
  async execute({ args, config, input, project, owner }) {
    if (!isIcqqLoginOperator(config, input)) return icqqLoginForbidden();
    const controls = icqqLoginControls({ project, owner });
    // One endpoint: the whole argument is the code. Multiple: first arg selects the UIN.
    const requested = controls.size > 1 ? args[0] : undefined;
    const value = (controls.size > 1 ? args.slice(1) : args).join(' ').trim();
    const picked = pickIcqqLoginControl(controls, requested);
    if (!picked.control) return picked.text ?? 'ICQQ 适配器还没有启动';
    if (!value) {
      return '请把验证内容放在命令后面，例如 `icqq login code 123456` 或 `icqq login code <ticket>`。';
    }
    const task = picked.control.pending()
      .find((item) => item.type === 'slider' || item.type === 'device' || item.type === 'sms' || item.type === 'other');
    if (!task) return '当前没有滑块/短信/设备验证待办；发送 `icqq login qr` 查看二维码。';
    if (!picked.control.submit(task.id, value)) return '登录待办已失效，请重新触发 `icqq login qr`。';
    return `已提交 ICQQ ${task.endpointKey} 的${pendingTaskLabel(task.type)}内容，正在验证。`;
  },
});
