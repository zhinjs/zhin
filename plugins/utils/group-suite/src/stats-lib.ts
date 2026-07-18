import type { GroupSuiteConfig } from './config.js';
import { getStatsModel } from './db-store.js';
import {
  resolveSender,
  todayStr,
  ts,
} from './shared-runtime.js';
import {
  buildStatsRankReportData,
  formatMyStatsText,
  formatRankText,
  type MyStatsReportData,
} from './stats-data.js';

export function weekStartStr(): string {
  const d = new Date();
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function monthStartStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

interface PendingIncrement {
  user_id: string;
  user_name: string;
  group_id: string;
  date: string;
  count: number;
}

const buffer = new Map<string, PendingIncrement>();

function bufferKey(userId: string, groupId: string, date: string): string {
  return `${userId}:${groupId}:${date}`;
}

export function resolveGroupId(input: {
  target?: string;
  metadata?: Readonly<Record<string, unknown>>;
}): string {
  const meta = input.metadata ?? {};
  const channelType = String(meta.type ?? meta.channelType ?? '');
  if (channelType === 'group' || channelType === 'guild') {
    return String(input.target ?? meta.channelId ?? '');
  }
  if (input.target && channelType !== 'private') {
    return String(input.target);
  }
  return '';
}

export function recordMessage(input: {
  sender?: string;
  target?: string;
  metadata?: Readonly<Record<string, unknown>>;
}): void {
  const { id: userId, name: userName } = resolveSender(input);
  if (!userId) return;
  const groupId = resolveGroupId(input);
  const key = bufferKey(userId, groupId, todayStr());
  const pending = buffer.get(key);
  if (pending) {
    pending.count++;
    pending.user_name = userName;
  } else {
    buffer.set(key, {
      user_id: userId,
      user_name: userName,
      group_id: groupId,
      date: todayStr(),
      count: 1,
    });
  }
}

export async function flushStatsBuffer(): Promise<void> {
  const M = getStatsModel();
  if (!M || buffer.size === 0) return;
  const entries = [...buffer.values()];
  buffer.clear();
  for (const entry of entries) {
    try {
      const existing = (await M.select().where({
        user_id: entry.user_id,
        group_id: entry.group_id,
        date: entry.date,
      })) as Record<string, unknown>[];
      if (existing.length > 0) {
        await M.update({
          count: Number(existing[0]!.count || 0) + entry.count,
          user_name: entry.user_name,
          updated_at: ts(),
        }).where({
          user_id: entry.user_id,
          group_id: entry.group_id,
          date: entry.date,
        });
      } else {
        await M.insert({
          user_id: entry.user_id,
          user_name: entry.user_name,
          group_id: entry.group_id,
          date: entry.date,
          count: entry.count,
          updated_at: ts(),
        });
      }
    } catch {
      /* single row failure */
    }
  }
}

export async function queryStats(
  groupId: string,
  fromDate: string,
): Promise<Map<string, { name: string; count: number }>> {
  const M = getStatsModel();
  if (!M) return new Map();
  const all = (groupId
    ? await M.select().where({ group_id: groupId })
    : await M.select()) as Record<string, unknown>[];
  const result = new Map<string, { name: string; count: number }>();
  for (const row of all) {
    if (String(row.date) < fromDate) continue;
    const userId = String(row.user_id);
    const existing = result.get(userId);
    if (existing) {
      existing.count += Number(row.count || 0);
      if (row.user_name) existing.name = String(row.user_name);
    } else {
      result.set(userId, {
        name: String(row.user_name || row.user_id),
        count: Number(row.count || 0),
      });
    }
  }
  return result;
}

type MessageInput = {
  sender?: string;
  target?: string;
  metadata?: Readonly<Record<string, unknown>>;
};

export async function statsRankText(
  input: MessageInput,
  cfg: GroupSuiteConfig,
  fromDate: string,
  title: string,
): Promise<string> {
  await flushStatsBuffer();
  const groupId = resolveGroupId(input);
  const stats = await queryStats(groupId, fromDate);
  const { id: userId } = resolveSender(input);
  const data = buildStatsRankReportData(stats, title, cfg.rankSize, userId);
  return formatRankText(data);
}

export async function myStatsText(input: MessageInput): Promise<string> {
  await flushStatsBuffer();
  const M = getStatsModel();
  if (!M) return '统计数据库尚未就绪';
  const { id: userId, name: userName } = resolveSender(input);
  if (!userId) return '无法获取用户信息';
  const groupId = resolveGroupId(input);
  const rows = (groupId
    ? await M.select().where({ user_id: userId, group_id: groupId })
    : await M.select().where({ user_id: userId })) as Record<string, unknown>[];
  if (rows.length === 0) return '暂无你的消息记录';
  const today = todayStr();
  const weekStart = weekStartStr();
  const monthStart = monthStartStr();
  let todayCount = 0;
  let weekCount = 0;
  let monthCount = 0;
  let totalCount = 0;
  for (const row of rows) {
    const c = Number(row.count || 0);
    totalCount += c;
    if (String(row.date) >= monthStart) monthCount += c;
    if (String(row.date) >= weekStart) weekCount += c;
    if (row.date === today) todayCount += c;
  }
  const data: MyStatsReportData = {
    userName: userName || '你',
    scope: groupId ? '本群' : '全局',
    todayCount,
    weekCount,
    monthCount,
    totalCount,
    activeDays: rows.length,
  };
  return formatMyStatsText(data);
}

/** Test helper */
export function resetStatsBuffer(): void {
  buffer.clear();
}
