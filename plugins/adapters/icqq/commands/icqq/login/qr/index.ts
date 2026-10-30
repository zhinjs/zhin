import { defineCommand } from 'zhin.js/command';
import {
  icqqLoginControlToken,
  icqqLoginForbidden,
  isIcqqLoginOperator,
  pickIcqqLoginControl,
} from '../definition.js';

const QR_IMAGE = /^data:image\/[a-z0-9.+-]+;base64,(.+)$/iu;

export default defineCommand({
  description: '获取 ICQQ 登录二维码（发给当前会话）',
  descriptionI18n: { en: 'Fetch the ICQQ login QR code into this conversation' },
  async execute({ args, config, input, use }) {
    if (!isIcqqLoginOperator(config, input)) return icqqLoginForbidden();
    const picked = pickIcqqLoginControl(use(icqqLoginControlToken), args[0]);
    if (!picked.control) return picked.text ?? 'ICQQ 适配器还没有启动';
    const control = picked.control;
    const findQr = () => control.pending().find((task) => task.type === 'qrcode' || task.type === 'auth');
    let task = findQr();
    if (!task) {
      const other = control.pending().find((item) => item.type !== 'qrcode' && item.type !== 'auth');
      if (other) {
        const url = typeof other.payload.url === 'string' ? other.payload.url : '';
        return `ICQQ ${other.endpointKey} 当前是${other.type === 'slider' ? '滑块验证' : '登录验证'}，请打开 ${url || '验证页面'}，`
          + '完成后回复 `icqq login code <内容>`。';
      }
      try {
        await control.relogin();
      } catch {
        // The SDK may still deliver a QR challenge asynchronously.
      }
      task = findQr();
      if (!task) return '已触发重新登录，请 5 秒后再发送 `icqq login qr` 获取二维码。';
    }
    const raw = typeof task.payload.image === 'string' ? task.payload.image : '';
    const base64 = QR_IMAGE.exec(raw)?.[1];
    if (!base64) {
      return `ICQQ ${task.endpointKey} 当前是 ${task.type === 'qrcode' ? '二维码' : '登录确认'}待办，但没有可发送的图片；请打开 Console 的 ICQQ 页面完成。`;
    }
    return [
      {
        type: 'text',
        data: {
          text: `ICQQ ${task.endpointKey} 登录二维码（约 3 分钟有效）。\n`
            + '用手机 QQ 扫码，完成后回复 `icqq login confirm`。',
        },
      },
      {
        type: 'image',
        data: { media: { kind: 'base64', value: base64, mime_type: 'image/png' } },
      },
    ];
  },
});
