import { defineCommand } from 'zhin.js/command';
import {
  activeIcqqChallenge,
  challengeCommandHint,
  icqqLoginControls,
  icqqLoginForbidden,
  isIcqqLoginOperator,
  pendingTaskLabel,
  pickIcqqLoginControl,
  submitIcqqAnswer,
} from '../definition.js';

export default defineCommand({
  description: '提交 ICQQ 滑块 ticket、短信验证码，或选择设备锁的验证方式',
  descriptionI18n: { en: 'Submit an ICQQ slider ticket or SMS code, or choose how to pass the device lock' },
  async execute({ args, config, input, project, owner }) {
    if (!isIcqqLoginOperator(config, input)) return icqqLoginForbidden();
    const controls = icqqLoginControls({ project, owner });
    // `icqq login code [uin] <内容>`: the UIN is required with several endpoints, optional with one.
    const named = args.length > 1 && controls.has(String(args[0]).trim());
    const requested = controls.size > 1 || named ? args[0] : undefined;
    const value = (requested !== undefined ? args.slice(1) : args).join(' ').trim();
    const picked = pickIcqqLoginControl(controls, requested);
    if (!picked.control) return picked.text ?? 'ICQQ 适配器还没有启动';
    const control = picked.control;
    if (!value) {
      return '请把验证内容放在命令后面，例如 `icqq login code 123456` 或 `icqq login code <ticket>`。';
    }
    const active = activeIcqqChallenge(control);
    if (!active || active.challenge.kind === 'qrcode' || active.challenge.kind === 'auth') {
      return active
        ? challengeCommandHint(active.challenge.kind, control.endpointId)
        : '当前没有滑块/短信/设备锁验证；发送 `icqq login status` 查看登录状态。';
    }
    const { kind } = active.challenge;
    const word = value.toLowerCase();
    let answer: string | Record<string, unknown> = value;
    if (kind === 'device') {
      if (word === 'sms') answer = { action: 'sms', values: {} };
      else if (word === 'ok' || word === 'continue') answer = { action: 'continue', values: {} };
      else return challengeCommandHint('device', control.endpointId);
      if (!active.challenge.actions.some((action) => action.id === (answer as { action: string }).action)) {
        return '这个设备锁不支持短信验证码，请用手机完成验证后回复 `icqq login confirm`。';
      }
    } else if (kind === 'sms' && word === 'resend') {
      answer = { action: 'resend', values: {} };
    }
    const result = submitIcqqAnswer(control, active.taskId, answer);
    if (!result.ok) return result.error ? `提交未通过：${result.error}` : '登录验证已失效，请发送 `icqq login status` 查看最新状态。';
    if (kind === 'device') {
      return word === 'sms' ? `已请求向 ICQQ ${control.endpointId} 的密保手机发送短信验证码，收到后回复 \`icqq login code <验证码>\`。`
        : `已确认 ICQQ ${control.endpointId} 的设备锁验证，正在登录。`;
    }
    if (kind === 'sms' && word === 'resend') return `已请求重新发送 ICQQ ${control.endpointId} 的短信验证码。`;
    return `已提交 ICQQ ${control.endpointId} 的${pendingTaskLabel(kind)}内容，正在验证。`;
  },
});
