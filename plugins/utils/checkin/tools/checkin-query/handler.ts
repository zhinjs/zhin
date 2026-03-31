import { getModel, todayStr } from '../../src/index.js';

export default async function (args: { user_id?: string }) {
  const M = getModel();
  if (!M) return '签到数据库尚未就绪';

  const userId = args.user_id;
  if (userId) {
    const rows: any[] = await M.select().where({ user_id: userId });
    if (rows.length === 0) return `用户 ${userId} 没有签到记录`;
    const u = rows[0];
    return `${u.user_name}: 积分=${u.points}, 累计=${u.total_checkins}天, 连续=${u.streak}天, 最长=${u.max_streak}天, 上次=${u.last_checkin}`;
  }

  const all: any[] = await M.select();
  const totalUsers = all.length;
  const totalPoints = all.reduce((s: number, u: any) => s + (u.points || 0), 0);
  const today = todayStr();
  const todayCount = all.filter((u: any) => u.last_checkin === today).length;
  return `签到系统统计\n总用户: ${totalUsers}\n总积分: ${totalPoints}\n今日签到: ${todayCount}人`;
}
