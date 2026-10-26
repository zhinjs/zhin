import { messages as t } from './i18n.js';
import type { ConversationInput } from './conversation-scope.js';
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
import type { GroupSuiteRuntime } from './runtime-state.js';

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

/**
 * 同一 user_id+context 的签到串行化（per-user promise 链），
 * 避免 check-then-act 竞态导致连发两条都签到成功。
 */
function serializedCheckin<T>(
  chains: Map<string, Promise<unknown>>,
  key: string,
  task: () => Promise<T>,
): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev.then(task, task);
  chains.set(key, next);
  return next.finally(() => {
    if (chains.get(key) === next) chains.delete(key);
  });
}

export async function doCheckin(
  input: ConversationInput,
  cfg: GroupSuiteConfig,
  runtime: GroupSuiteRuntime,
): Promise<string> {
  const M = getCheckinModel(runtime.db);
  if (!M) return t(input.locale, 'checkinRetry');

  const { id: userId, name: userName } = resolveSender(input);
  if (!userId) return t(input.locale, 'senderMissing');

  const { type: ctxType, id: ctxId } = resolveContextKey(input);
  return serializedCheckin(runtime.checkinChains, `${userId}:${ctxType}:${ctxId}`, async () => {
    const user = await getOrCreateUser(M, userId, userName, ctxType, ctxId);
    if (!user) return t(input.locale, 'checkinFailed');

    const today = todayStr();
    if (user.last_checkin === today) {
      return t(input.locale, 'alreadyChecked', { points: String(user.points), days: String(user.streak) });
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

    const lines = [t(input.locale, 'checkinDone'), t(input.locale, 'basePoints', { points: base })];
    if (bonus > 0) lines.push(t(input.locale, 'bonusPoints', { points: bonus, days: newStreak }));
    lines.push(t(input.locale, 'earnedPoints', { points: earned }), t(input.locale, 'currentPoints', { points: newPoints }));
    return lines.join('\n');
  });
}

export async function myPoints(
  input: ConversationInput,
  runtime: GroupSuiteRuntime,
  commandHead?: string,
): Promise<string> {
  const M = getCheckinModel(runtime.db);
  if (!M) return t(input.locale, 'checkinDb');
  const { id: userId } = resolveSender(input);
  const { type: ctxType, id: ctxId } = resolveContextKey(input);
  const rows = (await M.select().where({
    user_id: userId,
    context_type: ctxType,
    context_id: ctxId,
  })) as Record<string, unknown>[];
  if (rows.length === 0) return commandHead ? t(input.locale, 'checkinHint', { command: commandHead }) : t(input.locale, 'checkinHintNoHead');
  const u = rows[0];
  const checkedToday = u.last_checkin === todayStr();
  return [
    t(input.locale, 'pointsTitle', { name: String(u.user_name || t(input.locale, 'user')) }),
    t(input.locale, 'points', { points: String(u.points) }),
    t(input.locale, 'checkinTotal', { days: String(u.total_checkins) }),
    t(input.locale, 'checkinStreak', { days: String(u.streak) }),
    t(input.locale, 'checkinMax', { days: String(u.max_streak) }),
    checkedToday ? t(input.locale, 'checked') : t(input.locale, 'unchecked'),
  ].join('\n');
}

export async function pointsRank(
  input: ConversationInput,
  cfg: GroupSuiteConfig,
  runtime: GroupSuiteRuntime,
): Promise<string> {
  const M = getCheckinModel(runtime.db);
  if (!M) return t(input.locale, 'checkinDb');
  const { type: ctxType, id: ctxId } = resolveContextKey(input);
  const all = (await M.select().where(
    { context_type: ctxType, context_id: ctxId },
  )) as Record<string, unknown>[];
  if (all.length === 0) return t(input.locale, 'checkinEmpty');
  const sorted = all.sort((a, b) => Number(b.points || 0) - Number(a.points || 0));
  const top = sorted.slice(0, cfg.rankSize);
  const medals = ['🥇', '🥈', '🥉'];
  const lines = top.map((u, i) => {
    const prefix = i < 3 ? medals[i] : `${i + 1}.`;
    return t(input.locale, 'pointsRow', { prefix, name: String(u.user_name || u.user_id), points: String(u.points), days: String(u.total_checkins) });
  });
  const title = ctxType === 'group' ? t(input.locale, 'groupPoints')
    : ctxType === 'channel' ? t(input.locale, 'channelPoints') : t(input.locale, 'privatePoints');
  const { id: userId } = resolveSender(input);
  const myRank = sorted.findIndex((u) => u.user_id === userId);
  const footer = myRank >= 0 ? t(input.locale, 'myRankFooter', { rank: myRank + 1 }) : '';
  return `${title}\n${lines.join('\n')}${footer}`;
}
