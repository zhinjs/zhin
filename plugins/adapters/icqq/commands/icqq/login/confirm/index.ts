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
  description: '确认已完成 ICQQ 扫码、设备锁或身份验证',
  descriptionI18n: { en: 'Confirm the ICQQ QR scan, device lock or identity verification is done' },
  async execute({ args, config, input, project, owner }) {
    if (!isIcqqLoginOperator(config, input)) return icqqLoginForbidden();
    const picked = pickIcqqLoginControl(icqqLoginControls({ project, owner }), args[0]);
    if (!picked.control) return picked.text ?? 'ICQQ 适配器还没有启动';
    const control = picked.control;
    const active = activeIcqqChallenge(control);
    if (!active) return '当前没有等待确认的登录验证；发送 `icqq login qr` 获取二维码。';
    const { kind } = active.challenge;
    if (kind !== 'qrcode' && kind !== 'device' && kind !== 'auth') return challengeCommandHint(kind, control.endpointId);
    // A QR challenge takes the legacy `ok`; device lock / identity verification answer `continue`.
    const result = submitIcqqAnswer(control, active.taskId, kind === 'qrcode' ? 'ok' : { action: 'continue', values: {} });
    if (!result.ok) return result.error ? `提交未通过：${result.error}` : '登录验证已失效，请重新发送 `icqq login qr`。';
    return `已提交 ICQQ ${control.endpointId} 的${pendingTaskLabel(kind)}确认，正在登录。`;
  },
});
