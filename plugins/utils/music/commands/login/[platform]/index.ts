import { defineCommand } from 'zhin.js/command';
import type { Message } from '@zhin.js/core/runtime';
import {
  loginSessionKey,
  type QrLoginSource,
} from '../../../src/login/index.js';
import { resolveMessageIds } from '../../../src/session.js';
import { messages as t, sourceName as displayName } from '../../../src/i18n.js';
import { musicRuntimeToken } from '../../../src/runtime.js';

const QR_LOGIN_SOURCES: Record<string, QrLoginSource> = {
  qq: 'qq',
  netease: 'netease',
};

export default defineCommand<unknown, string, Message>({
  description: '扫码登录音乐平台获取凭证（master 专用）', descriptionI18n: { en: "Sign in to a music platform with a QR code (bot master only)" },
  params: {
    platform: { type: 'string', description: '音乐平台（qq / netease / 取消）', descriptionI18n: { en: "Music platform (qq / netease) or cancel" } },
  },
  permit: ['role(master)'],
  async execute({ params, input, use, locale, formatCommand }) {
    const platform = String(params.platform ?? '').trim();

    const ids = resolveMessageIds(input);
    if (!ids) return t(locale, 'conversation');
    const key = loginSessionKey(ids.conversation, ids.senderId);
    const runtime = use(musicRuntimeToken);

    const existing = runtime.logins.get(key);
    const flowLocale = existing?.locale ?? locale;
    const cancelInput = flowLocale === 'en' ? 'cancel' : '取消';
    const command = formatCommand('login');
    const cancelHint = command === undefined ? '' : t(flowLocale, 'cancelHint', { command: `${command} ${cancelInput}` });
    if (platform === cancelInput) {
      return t(flowLocale, runtime.logins.cancel(key) ? 'cancelLogin' : 'noLogin');
    }

    const source = QR_LOGIN_SOURCES[platform];
    if (!source) {
      return t(flowLocale, 'platform', { platform });
    }

    if (existing) {
      return [t(flowLocale, 'active', { source: displayName(existing.source, flowLocale) }), cancelHint].filter(Boolean).join('\n');
    }

    const sourceName = displayName(source, locale);
    let qrResult;
    try {
      qrResult = await runtime.logins.start(source, key, locale);
    } catch (err) {
      return t(locale, 'qrFailed', { source: sourceName, error: err instanceof Error ? err.message : String(err) });
    }

    const replyFn = input?.$reply;
    if (!replyFn) return t(locale, 'noReply');

    await replyFn([
      t(locale, 'scan', { source: sourceName }) + '\n',
      qrResult.imageSegment,
      '\n' + [t(locale, 'valid'), cancelHint].filter(Boolean).join('\n'),
    ]);

    const finalResult = await runtime.logins.poll(key, async (result) => {
      if (result.status === 'scanned') {
        await replyFn(`[${sourceName}] ${result.message}`);
      } else if (result.status === 'confirmed') {
        await replyFn(`[${sourceName}] ${t(locale, 'success')}`);
      } else if (result.status === 'expired' || result.status === 'error') {
        await replyFn(`[${sourceName}] ${result.message}`);
      }
    });

    if (finalResult.status === 'confirmed') return undefined as unknown as string;
    return `[${sourceName}] ${finalResult.message}`;
  },
});
