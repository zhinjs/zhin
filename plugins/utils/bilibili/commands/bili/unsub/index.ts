import { messages, commandHint } from '../../../src/i18n.js';
import { canManageConversation, defineCommand } from 'zhin.js/command';
import { parseUid } from '../../../src/api.js';
import { channelSourceError, extractChannelInfo, subscriptionScope } from '../../../src/channel.js';
import type { BilibiliConfig } from '../../../src/config.js';
import { bilibiliRuntimeToken } from '../../../src/runtime.js';
import { getBiliState, getBiliSubs } from '../../../src/store.js';

export default defineCommand<BilibiliConfig>({
  description: '取消当前会话对某个 UP 主的订阅（群聊限群主、管理员或机器人主人）', descriptionI18n: { en: "Unsubscribe this conversation from a Bilibili creator (group owner, administrator or bot master required in groups)" },
  params: { uid: { type: 'string', description: 'UP 主 UID 或空间链接', descriptionI18n: { en: "Creator UID or profile URL" } } },
  async execute({ locale, formatCommand, params, input, use, adapter, scene, sender }) {
    const runtime = use(bilibiliRuntimeToken);
    const Subs = getBiliSubs(runtime.db);
    if (!Subs) return messages(locale, 'db');
    const uid = parseUid(String(params.uid ?? ''));
    if (!uid) return messages(locale, 'uid') + commandHint(locale, formatCommand('bili unsub'), '<uid>');
    const channel = extractChannelInfo(input);
    if (!channel) return channelSourceError(input, locale);
    if (!canManageConversation({ adapter, scene, sender })) return messages(locale, 'denied');

    const scope = subscriptionScope(channel);
    const existing = await Subs.select().where({ uid, ...scope });
    if (existing.length === 0) return messages(locale, 'notSubscribed');
    await Subs.delete().where({ uid, ...scope });

    // Drop the watcher cursor and backoff once nobody watches this UP any more.
    const remaining = await Subs.select().where({ uid });
    if (remaining.length === 0) {
      await getBiliState(runtime.db)?.delete().where({ uid });
      runtime.watcher.forget(uid);
    }
    return messages(locale, 'removed', { name: String(existing[0]!.uname || uid) });
  },
});
