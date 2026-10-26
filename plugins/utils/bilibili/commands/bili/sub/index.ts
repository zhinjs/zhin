import { messages, kindText, commandHint } from '../../../src/i18n.js';
import { canManageConversation, defineCommand } from 'zhin.js/command';
import { BiliApiError, parseUid } from '../../../src/api.js';
import { channelSourceError, extractChannelInfo, subscriptionScope } from '../../../src/channel.js';
import type { BilibiliConfig } from '../../../src/config.js';
import { bilibiliRuntimeToken } from '../../../src/runtime.js';
import { getBiliSubs, parseKinds } from '../../../src/store.js';


export default defineCommand<BilibiliConfig>({
  description: '订阅 B 站 UP 主的开播和动态推送（群聊限群主、管理员或机器人主人）', descriptionI18n: { en: "Subscribe to a Bilibili creator's live streams and posts (group owner, administrator or bot master required in groups)" },
  params: {
    uid: { type: 'string', description: 'UP 主 UID 或空间链接', descriptionI18n: { en: "Creator UID or profile URL" } },
    kind: { type: 'string', default: 'all', description: 'all（默认）/ live / dynamic', descriptionI18n: { en: "all (default), live, or dynamic" } },
  },
  async execute({ locale, formatCommand, params, input, use, adapter, scene, sender }) {
    const runtime = use(bilibiliRuntimeToken);
    const Subs = getBiliSubs(runtime.db);
    if (!Subs) return messages(locale, 'db');

    const uid = parseUid(String(params.uid ?? ''));
    if (!uid) return messages(locale, 'uid') + commandHint(locale, formatCommand('bili sub'), '<uid> [all|live|dynamic]');
    const kinds = parseKinds(String(params.kind ?? 'all'));
    if (!kinds) return messages(locale, 'kind');

    const channel = extractChannelInfo(input);
    if (!channel) return channelSourceError(input, locale);
    if (!canManageConversation({ adapter, scene, sender })) return messages(locale, 'denied');
    const scope = subscriptionScope(channel);

    const existing = await Subs.select().where({ uid, ...scope });
    if (existing.length > 0) {
      if (existing[0]!.kinds === kinds) return messages(locale, 'exists');
      await Subs.update({ kinds }).where({ uid, ...scope });
      return messages(locale, 'changed', { name: String(existing[0]!.uname || uid), kind: kindText(kinds, locale) });
    }
    const current = await Subs.select().where(scope);
    if (current.length >= runtime.config.maxPerChannel) {
      return messages(locale, 'limit', { limit: runtime.config.maxPerChannel });
    }

    let uname = '';
    try {
      uname = (await runtime.client.getUserCard(uid)).name;
    } catch (error) {
      if (error instanceof BiliApiError && error.kind === 'not_found') return messages(locale, 'missingUser', { uid });
      // Lookup is cosmetic; subscribe anyway and let the watcher fill gaps.
    }

    await Subs.insert({
      uid,
      uname,
      kinds,
      ...scope,
      creator_id: channel.senderId,
      locale,
      created_at: new Date().toISOString(),
    });
    await runtime.watcher.baseline(uid).catch(() => undefined);

    const notes: string[] = [];
    if (!runtime.outbound) notes.push(messages(locale, 'noOutbound'));
    if (!runtime.persistent) notes.push(messages(locale, 'volatile'));
    return [messages(locale, 'subscribed', { name: uname || uid, uid, kind: kindText(kinds, locale) }), ...notes].join('\n');
  },
});
