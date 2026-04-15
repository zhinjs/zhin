import { flushBuffer, getModel, todayStr, weekStartStr } from '../../src/index.js';

export default async function (args: { user_id: string }) {
  await flushBuffer();
  const M = getModel();
  if (!M) return '统计数据库尚未就绪';

  const userId = args.user_id;
  if (!userId) return '请提供用户ID';

  const rows: any[] = await M.select().where({ user_id: userId });
  if (rows.length === 0) return `用户 ${userId} 暂无消息记录`;

  const today = todayStr();
  const weekStart = weekStartStr();
  let todayCount = 0, weekCount = 0, totalCount = 0;

  for (const row of rows) {
    const c = row.count || 0;
    totalCount += c;
    if (row.date >= weekStart) weekCount += c;
    if (row.date === today) todayCount += c;
  }

  const name = rows[0].user_name || userId;
  return `${name} 的统计\n今日: ${todayCount}条\n本周: ${weekCount}条\n总计: ${totalCount}条\n活跃天数: ${rows.length}天`;
}
