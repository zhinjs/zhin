import type { GroupSuiteConfig } from './config.js';
import { getCheckinModel } from './db-store.js';
import {
  randomInt,
  resolveContextKey,
  resolveSender,
  todayStr,
  ts,
  yesterdayStr,
} from './shared-runtime.js';

async function getOrCreateUser(
  model: any,
  userId: string,
  userName: string,
  ctxType: string,
  ctxId: string,
): Promise<Record<string, unknown> | null> {
  const rows = (await model.select().where({
    user_id: userId,
    context_type: ctxType,
    context_id: ctxId,
  })) as Record<string, unknown>[];
  if (rows.length > 0) return rows[0];

  await model.insert({
    user_id: userId,
    user_name: userName,
    points: 0,
    total_checkins: 0,
    streak: 0,
    max_streak: 0,
    last_checkin: '',
    context_type: ctxType,
    context_id: ctxId,
    created_at: ts(),
    updated_at: ts(),
  });

  const created = (await model.select().where({
    user_id: userId,
    context_type: ctxType,
    context_id: ctxId,
  })) as Record<string, unknown>[];
  return created[0] ?? null;
}

export async function doCheckin(
  input: { sender?: string; target?: string; metadata?: Readonly<Record<string, unknown>> },
  cfg: GroupSuiteConfig,
): Promise<string> {
  const M = getCheckinModel();
  if (!M) return '签到数据库尚未就绪，请稍后重试';

  const { id: userId, name: userName } = resolveSender(input);
  if (!userId) return '无法获取用户信息';

  const { type: ctxType, id: ctxId } = resolveContextKey(input);
  const user = await getOrCreateUser(M, userId, userName, ctxType, ctxId);
  if (!user) return '签到失败，请重试';

  const today = todayStr();
  if (user.last_checkin === today) {
    return `你今天已经签到过了哦～\n当前积分: ${user.points}\n连续签到: ${user.streak} 天`;
  }

  const isConsecutive = user.last_checkin === yesterdayStr();
  const newStreak = isConsecutive ? Number(user.streak) + 1 : 1;
  const base = randomInt(cfg.basePointsMin, cfg.basePointsMax);
  const bonus = Math.min(newStreak * cfg.streakBonus, cfg.streakCap);
  const earned = base + bonus;
  const newPoints = Number(user.points || 0) + earned;

  await M.update({
    points: newPoints,
    total_checkins: Number(user.total_checkins || 0) + 1,
    streak: newStreak,
    max_streak: Math.max(Number(user.max_streak || 0), newStreak),
    last_checkin: today,
    user_name: userName,
    updated_at: ts(),
  }).where({
    user_id: userId,
    context_type: ctxType,
    context_id: ctxId,
  });

  const lines = [`签到成功！`, `基础积分: +${base}`];
  if (bonus > 0) lines.push(`连续奖励: +${bonus} (连续${newStreak}天)`);
  lines.push(`本次获得: +${earned}`, `当前积分: ${newPoints}`);
  return lines.join('\n');
}

export async function myPoints(
  input: { sender?: string; target?: string; metadata?: Readonly<Record<string, unknown>> },
): Promise<string> {
  const M = getCheckinModel();
  if (!M) return '签到数据库尚未就绪';
  const { id: userId } = resolveSender(input);
  const { type: ctxType, id: ctxId } = resolveContextKey(input);
  const rows = (await M.select().where({
    user_id: userId,
    context_type: ctxType,
    context_id: ctxId,
  })) as Record<string, unknown>[];
  if (rows.length === 0) return '你还没有签到记录哦，发送「checkin」开始吧！';
  const u = rows[0];
  const checkedToday = u.last_checkin === todayStr();
  return [
    `${u.user_name || '用户'} 的积分信息`,
    `积分: ${u.points}`,
    `累计签到: ${u.total_checkins} 天`,
    `连续签到: ${u.streak} 天`,
    `最长连续: ${u.max_streak} 天`,
    checkedToday ? '今日已签到 ✓' : '今日未签到',
  ].join('\n');
}

export async function pointsRank(
  input: { sender?: string; target?: string; metadata?: Readonly<Record<string, unknown>> },
  cfg: GroupSuiteConfig,
): Promise<string> {
  const M = getCheckinModel();
  if (!M) return '签到数据库尚未就绪';
  const { type: ctxType, id: ctxId } = resolveContextKey(input);
  const all = (await M.select().where(
    ctxType === 'global'
      ? { context_type: 'global' }
      : { context_type: ctxType, context_id: ctxId },
  )) as Record<string, unknown>[];
  if (all.length === 0) return '还没有人签到过哦～';
  const sorted = all.sort((a, b) => Number(b.points || 0) - Number(a.points || 0));
  const top = sorted.slice(0, cfg.rankSize);
  const medals = ['🥇', '🥈', '🥉'];
  const lines = top.map((u, i) => {
    const prefix = i < 3 ? medals[i] : `${i + 1}.`;
    return `${prefix} ${u.user_name || u.user_id} — ${u.points}分 (${u.total_checkins}天)`;
  });
  const title = ctxType === 'group' ? '本群积分排行' : '全局积分排行';
  const { id: userId } = resolveSender(input);
  const myRank = sorted.findIndex((u) => u.user_id === userId);
  const footer = myRank >= 0 ? `\n你的排名: 第${myRank + 1}名` : '';
  return `${title}\n${lines.join('\n')}${footer}`;
}
