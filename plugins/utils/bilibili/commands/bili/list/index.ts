import { messages, kindText, commandHint } from '../../../src/i18n.js';
import { defineCommand } from 'zhin.js/command';
import { channelSourceError, extractChannelInfo, subscriptionScope } from '../../../src/channel.js';
import type { BilibiliConfig } from '../../../src/config.js';
import { bilibiliRuntimeToken } from '../../../src/runtime.js';
import { getBiliSubs } from '../../../src/store.js';


export default defineCommand<BilibiliConfig>({
  description: '查看当前会话的 B 站订阅', descriptionI18n: { en: "List this conversation's Bilibili subscriptions" },
  async execute({ locale, formatCommand, input, use }) {
    const runtime = use(bilibiliRuntimeToken);
    const Subs = getBiliSubs(runtime.db);
    if (!Subs) return messages(locale, 'db');
    const channel = extractChannelInfo(input);
    if (!channel) return channelSourceError(input, locale);

    const rows = await Subs.select().where(subscriptionScope(channel));
    if (rows.length === 0) return messages(locale, 'empty') + commandHint(locale, formatCommand('bili sub'), '<uid>');
    const lines = rows.map((row, index) =>
      `${index + 1}. ${String(row.uname || messages(locale, 'unknown'))}（UID ${String(row.uid)}）· ${kindText(row.kinds, locale)}`);
    const status = runtime.watcher.backoffStatus(locale);
    if (status.length > 0) lines.push('', messages(locale, 'paused'), ...status);
    return messages(locale, 'list', { count: rows.length, limit: runtime.config.maxPerChannel, items: lines.join('\n') });
  },
});
