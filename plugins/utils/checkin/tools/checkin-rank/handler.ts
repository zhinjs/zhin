import { getModel } from '../../src/index.js';

export default async function (args: { limit?: number }) {
  const M = getModel();
  if (!M) return '签到数据库尚未就绪';

  const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 50);
  const all: any[] = await M.select();
  const sorted = all.sort((a: any, b: any) => (b.points || 0) - (a.points || 0)).slice(0, limit);

  if (sorted.length === 0) return '暂无排行数据';

  return sorted
    .map((u: any, i: number) => `${i + 1}. ${u.user_name || u.user_id} — ${u.points}分 (连续${u.streak}天)`)
    .join('\n');
}
