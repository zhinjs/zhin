import { defineCommand } from 'zhin.js/command';
import { channelSourceError, extractChannelInfo, subscriptionScope } from '../../../src/channel.js';
import type { BilibiliConfig } from '../../../src/config.js';
import { bilibiliRuntimeToken } from '../../../src/runtime.js';
import { getBiliSubs } from '../../../src/store.js';

const KIND_TEXT: Record<string, string> = { all: '开播+动态', live: '开播', dynamic: '动态' };

export default defineCommand<BilibiliConfig>({
  description: '查看当前会话的 B 站订阅',
  async execute({ input, use }) {
    const runtime = use(bilibiliRuntimeToken);
    const Subs = getBiliSubs(runtime.db);
    if (!Subs) return 'B 站订阅数据库尚未就绪，请稍后重试';
    const channel = extractChannelInfo(input);
    if (!channel) return channelSourceError(input);

    const rows = await Subs.select().where(subscriptionScope(channel));
    if (rows.length === 0) return '当前会话没有订阅任何 UP 主\n使用 bili sub <uid> 添加订阅';
    const lines = rows.map((row, index) =>
      `${index + 1}. ${String(row.uname || '(未知)')}（UID ${String(row.uid)}）· ${KIND_TEXT[String(row.kinds)] ?? '开播+动态'}`);
    const status = runtime.watcher.backoffStatus();
    if (status.length > 0) lines.push('', '暂停中的请求：', ...status);
    return `当前订阅 (${rows.length}/${runtime.config.maxPerChannel})：\n${lines.join('\n')}`;
  },
});
