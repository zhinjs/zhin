import { defineCommand } from 'zhin.js/command';
import { BiliApiError, parseUid } from '../../../src/api.js';
import { channelSourceError, extractChannelInfo, subscriptionScope } from '../../../src/channel.js';
import type { BilibiliConfig } from '../../../src/config.js';
import { bilibiliRuntimeToken } from '../../../src/runtime.js';
import { getBiliSubs, parseKinds } from '../../../src/store.js';

const KIND_TEXT = { all: '开播 + 动态', live: '开播', dynamic: '动态' } as const;

export default defineCommand<BilibiliConfig>({
  description: '订阅 B 站 UP 主的开播和动态推送',
  params: {
    uid: { type: 'string', description: 'UP 主 UID 或空间链接' },
    kind: { type: 'string', default: 'all', description: 'all（默认）/ live / dynamic' },
  },
  async execute({ params, input, use }) {
    const runtime = use(bilibiliRuntimeToken);
    const Subs = getBiliSubs(runtime.db);
    if (!Subs) return 'B 站订阅数据库尚未就绪，请稍后重试';

    const uid = parseUid(String(params.uid ?? ''));
    if (!uid) return '请提供 UP 主 UID 或空间链接，格式：bili sub <uid> [all|live|dynamic]';
    const kinds = parseKinds(String(params.kind ?? 'all'));
    if (!kinds) return '订阅类型只能是 all、live 或 dynamic';

    const channel = extractChannelInfo(input);
    if (!channel) return channelSourceError(input);
    const scope = subscriptionScope(channel);

    const existing = await Subs.select().where({ uid, ...scope });
    if (existing.length > 0) {
      if (existing[0]!.kinds === kinds) return '当前会话已订阅该 UP 主，无需重复添加';
      await Subs.update({ kinds }).where({ uid, ...scope });
      return `已将 ${String(existing[0]!.uname || uid)} 的订阅改为：${KIND_TEXT[kinds]}`;
    }
    const current = await Subs.select().where(scope);
    if (current.length >= runtime.config.maxPerChannel) {
      return `当前会话订阅数已达上限 (${runtime.config.maxPerChannel})，请先取消一些`;
    }

    let uname = '';
    try {
      uname = (await runtime.client.getUserCard(uid)).name;
    } catch (error) {
      if (error instanceof BiliApiError && error.kind === 'not_found') return `找不到 UID 为 ${uid} 的用户`;
      // Lookup is cosmetic; subscribe anyway and let the watcher fill gaps.
    }

    await Subs.insert({
      uid,
      uname,
      kinds,
      ...scope,
      creator_id: channel.senderId,
      created_at: new Date().toISOString(),
    });
    await runtime.watcher.baseline(uid).catch(() => undefined);

    const notes: string[] = [];
    if (!runtime.outbound) notes.push('⚠ 未接入 OutboundHost，暂时无法主动推送');
    if (!runtime.persistent) notes.push('⚠ 未配置数据库，订阅在重启后会丢失');
    return [`订阅成功：${uname || uid}（UID ${uid}），类型：${KIND_TEXT[kinds]}`, ...notes].join('\n');
  },
});
