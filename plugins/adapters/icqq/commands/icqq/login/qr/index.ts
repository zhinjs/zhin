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

const QR_IMAGE = /^data:image\/[a-z0-9.+-]+;base64,(.+)$/iu;

export default defineCommand({
  description: '获取 ICQQ 登录二维码（发给当前会话）',
  descriptionI18n: { en: 'Fetch the ICQQ login QR code into this conversation' },
  async execute({ args, config, input, project, owner }) {
    if (!isIcqqLoginOperator(config, input)) return icqqLoginForbidden();
    const picked = pickIcqqLoginControl(icqqLoginControls({ project, owner }), args[0]);
    if (!picked.control) return picked.text ?? 'ICQQ 适配器还没有启动';
    const control = picked.control;
    let active = activeIcqqChallenge(control);
    if (active && active.challenge.kind !== 'qrcode') {
      const links = challengeLinks(active.challenge).map((link) => `${link.label}：${link.url}`);
      return [`ICQQ ${control.endpointId} 当前是${pendingTaskLabel(active.challenge.kind)}，不是扫码登录。`, ...links,
        challengeCommandHint(active.challenge.kind, control.endpointId)].join('\n');
    }
    if (!active) {
      try {
        await control.relogin();
      } catch {
        // The SDK may still deliver a QR challenge asynchronously.
      }
      active = activeIcqqChallenge(control);
      if (!active || active.challenge.kind !== 'qrcode') return '已触发重新登录，请 5 秒后再发送 `icqq login qr` 获取二维码。';
    }
    const raw = active.challenge.media?.qrImage ?? '';
    const base64 = QR_IMAGE.exec(raw)?.[1];
    if (!base64) {
      return `ICQQ ${control.endpointId} 正在等待扫码，但没有可发送的二维码图片；请打开 Console 的 ICQQ 页面完成。`;
    }
    return [
      {
        type: 'text',
        data: {
          text: `ICQQ ${control.endpointId} 登录二维码（约 2 分钟有效）。\n`
            + '用手机 QQ 扫码，并在手机上确认登录，登录会自动继续；没有继续时回复 `icqq login confirm`。',
        },
      },
      {
        type: 'image',
        data: { media: { kind: 'base64', value: base64, mime_type: 'image/png' } },
      },
    ];
  },
});
