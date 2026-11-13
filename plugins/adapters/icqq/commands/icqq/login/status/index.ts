import { defineCommand } from 'zhin.js/command';
import {
  activeIcqqChallenge,
  challengeCommandHint,
  challengeLinks,
  icqqLoginControls,
  icqqLoginForbidden,
  isIcqqLoginOperator,
  pendingTaskLabel,
  pickIcqqLoginControl,
} from '../definition.js';

export default defineCommand({
  description: '查看 ICQQ 掉线状态与登录验证',
  descriptionI18n: { en: 'Show ICQQ offline status and the pending login verification' },
  async execute({ args, config, input, project, owner }) {
    if (!isIcqqLoginOperator(config, input)) return icqqLoginForbidden();
    const picked = pickIcqqLoginControl(icqqLoginControls({ project, owner }), args[0]);
    if (!picked.control) return picked.text ?? 'ICQQ 适配器还没有启动';
    const control = picked.control;
    const state = control.state();
    const lines = [`ICQQ ${state.endpointId}: ${state.online ? '在线' : '离线'}（${state.transportState}）`];
    const flow = control.flow();
    const active = activeIcqqChallenge(control);
    if (active) {
      const { challenge } = active;
      lines.push(`待处理：${pendingTaskLabel(challenge.kind)}（${challenge.title}）`);
      if (challenge.help?.short) lines.push(challenge.help.short);
      (challenge.help?.steps ?? []).forEach((step, index) => {
        lines.push(`${index + 1}. ${typeof step === 'string' ? step : step.text}`);
      });
      if (challenge.help?.warning) lines.push(`⚠ ${challenge.help.warning}`);
      for (const link of challengeLinks(challenge)) lines.push(`${link.label}：${link.url}`);
      lines.push(challengeCommandHint(challenge.kind, state.endpointId));
    } else if (state.pending.length > 0) {
      // A challenge raised outside the login flow (another LoginAssist producer).
      lines.push('待处理：');
      for (const task of state.pending) {
        const url = typeof task.payload.url === 'string' ? task.payload.url : undefined;
        lines.push(`- ${pendingTaskLabel(task.type)}（${task.id}）${url ? `：${url}` : ''}`);
      }
    } else {
      lines.push('没有待处理的登录验证。');
      const outcome = flow?.lastOutcome;
      if (flow && (flow.state === 'failed' || flow.state === 'expired')) {
        lines.push(`上次登录${flow.state === 'expired' ? '验证已过期' : '失败'}${outcome?.message ? `：${outcome.message}` : ''}。`
          + '发送 `icqq login retry` 重新登录。');
      }
    }
    return lines.join('\n');
  },
});
