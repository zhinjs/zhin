import { messages as t } from './i18n.js';
import { conversationKey, requireConversation, type ConversationInput } from './conversation-scope.js';
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
import type { GroupSuiteRuntime, PendingStatsIncrement } from './runtime-state.js';

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

function bufferKey(userId: string, groupId: string, date: string): string {
  return JSON.stringify([userId, groupId, date]);
}

export function resolveGroupId(input: ConversationInput): string {
  return conversationKey(requireConversation(input));
}

export function recordMessage(input: ConversationInput, runtime: GroupSuiteRuntime): void {
  const targetBuffer = runtime.statsBuffer;
  const { id: userId, name: userName } = resolveSender(input);
  if (!userId) return;
  const groupId = resolveGroupId(input);
  const key = bufferKey(userId, groupId, todayStr());
  const pending = targetBuffer.get(key);
  if (pending) {
    pending.count++;
    pending.recorded++;
    pending.user_name = userName;
  } else {
    targetBuffer.set(key, {
      user_id: userId,
      user_name: userName,
      group_id: groupId,
      date: todayStr(),
      count: 1,
      recorded: 1,
      flushed: 0,
    });
  }
}

interface StatsBatchEntry {
  readonly key: string;
  readonly entry: PendingStatsIncrement;
  readonly watermark: number;
}

/** Flush only the increments visible to this caller; new traffic cannot prolong its batch. */
export function flushStatsBuffer(runtime: GroupSuiteRuntime): Promise<void> {
  const batch = [...runtime.statsBuffer.entries()].map(([key, entry]) => ({
    key, entry, watermark: entry.recorded,
  }));
  const previous = runtime.statsFlush ?? Promise.resolve();
  const flush = previous.catch(() => undefined).then(() => flushStatsBatch(runtime, batch)).finally(() => {
    if (runtime.statsFlush === flush) runtime.statsFlush = undefined;
  });
  runtime.statsFlush = flush;
  return flush;
}

async function flushStatsBatch(runtime: GroupSuiteRuntime, batch: readonly StatsBatchEntry[]): Promise<void> {
  const targetBuffer = runtime.statsBuffer;
  if (batch.length === 0) return;
  const M = getStatsModel(runtime.db);
  if (!M) return;
  for (const { key, entry, watermark } of batch) {
    // Earlier batches may already have committed part/all of this caller's watermark.
    const countSnapshot = Math.min(entry.count, watermark - entry.flushed);
    if (countSnapshot <= 0 || targetBuffer.get(key) !== entry) continue;
    try {
      const existing = (await M.select().where({
        user_id: entry.user_id,
        group_id: entry.group_id,
        date: entry.date,
      })) as Record<string, unknown>[];
      if (existing.length > 0) {
        await M.update({
          count: Number(existing[0]!.count || 0) + countSnapshot,
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
          count: countSnapshot,
          updated_at: ts(),
        });
      }
      // 只移除写入成功的部分；失败的 key 留在缓冲等下一轮重试
      entry.count -= countSnapshot;
      entry.flushed += countSnapshot;
      if (entry.count <= 0 && targetBuffer.get(key) === entry) targetBuffer.delete(key);
    } catch {
      /* single row failure: keep entry in buffer for next flush */
    }
  }
}

export async function queryStats(
  groupId: string,
  fromDate: string,
  runtime: GroupSuiteRuntime,
): Promise<Map<string, { name: string; count: number }>> {
  const M = getStatsModel(runtime.db);
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

type MessageInput = ConversationInput;

export async function statsRankText(
  input: MessageInput,
  cfg: GroupSuiteConfig,
  fromDate: string,
  title: string,
  runtime: GroupSuiteRuntime,
): Promise<string> {
  await flushStatsBuffer(runtime);
  const groupId = resolveGroupId(input);
  const stats = await queryStats(groupId, fromDate, runtime);
  const { id: userId } = resolveSender(input);
  const data = buildStatsRankReportData(stats, title, cfg.rankSize, userId);
  return formatRankText(data, input.locale);
}

export async function myStatsText(input: MessageInput, runtime: GroupSuiteRuntime): Promise<string> {
  await flushStatsBuffer(runtime);
  const M = getStatsModel(runtime.db);
  if (!M) return t(input.locale, 'statsDb');
  const { id: userId, name: userName } = resolveSender(input);
  if (!userId) return t(input.locale, 'senderMissing');
  const groupId = resolveGroupId(input);
  const rows = (groupId
    ? await M.select().where({ user_id: userId, group_id: groupId })
    : await M.select().where({ user_id: userId })) as Record<string, unknown>[];
  if (rows.length === 0) return t(input.locale, 'myStatsEmpty');
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
    userName: userName || t(input.locale, 'you'),
    scope: groupId ? t(input.locale, 'thisGroup') : t(input.locale, 'global'),
    todayCount,
    weekCount,
    monthCount,
    totalCount,
    activeDays: rows.length,
  };
  return formatMyStatsText(data, input.locale);
}
