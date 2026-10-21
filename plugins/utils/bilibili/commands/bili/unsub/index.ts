import { canManageConversation, defineCommand } from 'zhin.js/command';
import { parseUid } from '../../../src/api.js';
import { channelSourceError, extractChannelInfo, subscriptionScope } from '../../../src/channel.js';
import type { BilibiliConfig } from '../../../src/config.js';
import { bilibiliRuntimeToken } from '../../../src/runtime.js';
import { SUBSCRIPTION_PERMISSION_DENIED_MESSAGE } from '../../../src/permission.js';
import { getBiliState, getBiliSubs } from '../../../src/store.js';

export default defineCommand<BilibiliConfig>({
  description: '取消当前会话对某个 UP 主的订阅（群聊限群主、管理员或机器人主人）',
  params: { uid: { type: 'string', description: 'UP 主 UID 或空间链接' } },
  async execute({ params, input, use, adapter, scene, sender }) {
    const runtime = use(bilibiliRuntimeToken);
    const Subs = getBiliSubs(runtime.db);
    if (!Subs) return 'B 站订阅数据库尚未就绪，请稍后重试';
    const uid = parseUid(String(params.uid ?? ''));
    if (!uid) return '请提供 UP 主 UID，格式：bili unsub <uid>';
    const channel = extractChannelInfo(input);
    if (!channel) return channelSourceError(input);
    if (!canManageConversation({ adapter, scene, sender })) return SUBSCRIPTION_PERMISSION_DENIED_MESSAGE;

    const scope = subscriptionScope(channel);
    const existing = await Subs.select().where({ uid, ...scope });
    if (existing.length === 0) return '当前会话没有订阅该 UP 主';
    await Subs.delete().where({ uid, ...scope });

    // Drop the watcher cursor and backoff once nobody watches this UP any more.
    const remaining = await Subs.select().where({ uid });
    if (remaining.length === 0) {
      await getBiliState(runtime.db)?.delete().where({ uid });
      runtime.watcher.forget(uid);
    }
    return `已取消订阅：${String(existing[0]!.uname || uid)}`;
  },
});
