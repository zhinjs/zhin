import { defineCommand } from 'zhin.js/command';
import {
  icqqLoginControlToken,
  icqqLoginForbidden,
  isIcqqLoginOperator,
  pendingTaskLabel,
  pickIcqqLoginControl,
} from '../definition.js';

export default defineCommand({
  description: '查看 ICQQ 掉线状态与登录待办',
  descriptionI18n: { en: 'Show ICQQ offline status and pending login tasks' },
  async execute({ args, config, input, use }) {
    if (!isIcqqLoginOperator(config, input)) return icqqLoginForbidden();
    const picked = pickIcqqLoginControl(use(icqqLoginControlToken), args[0]);
    if (!picked.control) return picked.text ?? 'ICQQ 适配器还没有启动';
    const state = picked.control.state();
    const lines = [
      `ICQQ ${state.endpointId}: ${state.online ? '在线' : '离线'}（${state.transportState}）`,
    ];
    if (state.pending.length === 0) {
      lines.push('没有待处理的登录验证。');
    } else {
      lines.push('待处理：');
      for (const task of state.pending) {
        const url = typeof task.payload.url === 'string' ? task.payload.url : undefined;
        lines.push(`- ${pendingTaskLabel(task.type)}（${task.id}，endpoint ${task.endpointKey}）`
          + (url ? `：${url}` : ''));
      }
      lines.push('二维码：`icqq login qr`；完成扫码后：`icqq login confirm`；滑块/短信：`icqq login code <内容>`。');
    }
    return lines.join('\n');
  },
});
