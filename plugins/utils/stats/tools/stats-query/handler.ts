import { flushBuffer, queryStats, todayStr, weekStartStr, monthStartStr } from '../../src/index.js';

export default async function (args: { group_id?: string; period?: string }) {
  await flushBuffer();
  const groupId = args.group_id || '';
  const period = args.period || 'today';

  let fromDate: string;
  switch (period) {
    case 'week': fromDate = weekStartStr(); break;
    case 'month': fromDate = monthStartStr(); break;
    default: fromDate = todayStr(); break;
  }

  const stats = await queryStats(groupId, fromDate);
  if (stats.size === 0) return `${period} 暂无消息统计数据`;

  const sorted = [...stats.entries()].sort((a, b) => b[1].count - a[1].count);
  const total = sorted.reduce((s, [, v]) => s + v.count, 0);

  const top10 = sorted.slice(0, 10);
  const lines = top10.map(([, v], i) => `${i + 1}. ${v.name} — ${v.count}条`);

  return `消息统计 (${period})\n总消息: ${total}条, 活跃用户: ${stats.size}人\n${lines.join('\n')}`;
}
