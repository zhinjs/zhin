import { defineCommand } from '@zhin.js/command';
import type { Message } from '@zhin.js/core/runtime';
import {
  startLogin,
  pollLogin,
  cancelLogin,
  getActiveLogin,
  loginSessionKey,
  type QrLoginSource,
} from '../../src/login/index.js';
import { resolveMessageIds } from '../../src/session.js';
import { SOURCE_DISPLAY_NAME } from '../../src/config.js';

const QR_LOGIN_SOURCES: Record<string, QrLoginSource> = {
  qq: 'qq',
  netease: 'netease',
};

export default defineCommand<unknown, string, Message>({
  description: '扫码登录音乐平台获取凭证（master 专用）',
  params: {
    platform: { type: 'string', description: '音乐平台（qq / netease / 取消）' },
  },
  permit: ['role(master)'],
  async execute({ params, input }) {
    const platform = String(params.platform ?? '').trim();

    const ids = resolveMessageIds(input!);
    if (!ids) return '无法识别会话信息，请在群聊或私聊中使用';
    const key = loginSessionKey(ids.endpointId, ids.conversationId, ids.senderId);

    if (platform === '取消' || platform === 'cancel') {
      return cancelLogin(key) ? '已取消登录' : '没有进行中的登录会话';
    }

    const source = QR_LOGIN_SOURCES[platform];
    if (!source) {
      return `不支持的平台：${platform || '(空)'}\n支持：qq, netease`;
    }

    const existing = getActiveLogin(key);
    if (existing) {
      return `正在进行 ${SOURCE_DISPLAY_NAME[existing.source]} 登录，请先完成或发送"音乐登录 取消"`;
    }

    const sourceName = SOURCE_DISPLAY_NAME[source];
    let qrResult;
    try {
      qrResult = await startLogin(source, key);
    } catch (err) {
      return `[${sourceName}] 获取二维码失败：${err instanceof Error ? err.message : String(err)}`;
    }

    const replyFn = input?.$reply;
    if (!replyFn) return '无法发送消息';

    await replyFn([
      `[${sourceName}] 请使用 ${sourceName} App 扫描二维码登录：\n`,
      qrResult.imageSegment,
      `\n二维码有效期 2 分钟，发送"音乐登录 取消"可中止`,
    ]);

    const finalResult = await pollLogin(key, async (result) => {
      if (result.status === 'scanned') {
        await replyFn(`[${sourceName}] ${result.message}`);
      } else if (result.status === 'confirmed') {
        await replyFn(`[${sourceName}] 登录成功！cookie 已自动保存，现在可以搜索和播放高品质音乐了`);
      } else if (result.status === 'expired' || result.status === 'error') {
        await replyFn(`[${sourceName}] ${result.message}`);
      }
    });

    if (finalResult.status === 'confirmed') return undefined as unknown as string;
    return `[${sourceName}] ${finalResult.message}`;
  },
});
