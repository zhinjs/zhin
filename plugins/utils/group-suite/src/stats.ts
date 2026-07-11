import { formatCompact, isActionMessage, MessageCommand, segment, type Plugin } from "zhin.js";
import type { GroupSuiteConfig } from "./config.js";
import { todayStr, ts } from "./shared.js";
import { buildStatsRankReportData, type MyStatsReportData } from "./stats-data.js";
import { buildMyStatsHtml, buildStatsRankHtml, STATS_REPORT_CANVAS } from "./stats-card.js";

export function weekStartStr(): string {
  const d = new Date();
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function monthStartStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

let _db: any = null;

export function getStatsModel(): any {
  return _db?.models?.get("message_stats") ?? null;
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

function getGroupId(message: { $channel?: { type?: string; id?: string } }): string {
  if (message.$channel?.type === "group") {
    return String(message.$channel.id ?? "");
  }
  return "";
}

export async function flushStatsBuffer(): Promise<void> {
  const M = getStatsModel();
  if (!M || buffer.size === 0) return;
  const entries = [...buffer.values()];
  buffer.clear();
  for (const entry of entries) {
    try {
      const existing: any[] = await M.select().where({
        user_id: entry.user_id,
        group_id: entry.group_id,
        date: entry.date,
      });
      if (existing.length > 0) {
        await M.update({
          count: (existing[0].count || 0) + entry.count,
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
  const all: any[] = groupId
    ? await M.select().where({ group_id: groupId })
    : await M.select();
  const result = new Map<string, { name: string; count: number }>();
  for (const row of all) {
    if (row.date < fromDate) continue;
    const existing = result.get(row.user_id);
    if (existing) {
      existing.count += row.count || 0;
      if (row.user_name) existing.name = row.user_name;
    } else {
      result.set(row.user_id, {
        name: row.user_name || row.user_id,
        count: row.count || 0,
      });
    }
  }
  return result;
}

function statsRankReply(data: ReturnType<typeof buildStatsRankReportData>) {
  return segment.html({
    html: buildStatsRankHtml(data),
    width: 540,
    backgroundColor: STATS_REPORT_CANVAS,
    fileName: "message-stats-rank.png",
  });
}

function myStatsReply(data: MyStatsReportData) {
  return segment.html({
    html: buildMyStatsHtml(data),
    width: 540,
    backgroundColor: STATS_REPORT_CANVAS,
    fileName: "my-message-stats.png",
  });
}

export function registerStats(plugin: Plugin, cfg: GroupSuiteConfig): void {
  const { logger, addCommand, useContext, onDispose } = plugin;

  useContext("database", (db: any) => {
    _db = db;
    db.define("message_stats", {
      user_id: { type: "text", nullable: false },
      user_name: { type: "text", default: "" },
      group_id: { type: "text", default: "" },
      date: { type: "text", nullable: false },
      count: { type: "integer", default: 0 },
      updated_at: { type: "text", default: "" },
    });
    logger.debug(formatCompact({ 模块: "消息统计", 数据模型: "已就绪" }));
  });

  const flushTimer = setInterval(flushStatsBuffer, 10_000);
  onDispose(async () => {
    clearInterval(flushTimer);
    await flushStatsBuffer();
    buffer.clear();
  });

  plugin.root.addMiddleware(async (message, next) => {
    if (isActionMessage(message)) return next();
    const userId = String(message.$sender?.id || "");
    if (!userId) return next();
    const key = bufferKey(userId, getGroupId(message), todayStr());
    const pending = buffer.get(key);
    if (pending) {
      pending.count++;
      pending.user_name = String(message.$sender?.name || "");
    } else {
      buffer.set(key, {
        user_id: userId,
        user_name: String(message.$sender?.name || ""),
        group_id: getGroupId(message),
        date: todayStr(),
        count: 1,
      });
    }
    return next();
  });

  addCommand(
    new MessageCommand("stats")
      .desc("消息统计", "查看今日消息统计")
      .action(async (message) => {
        await flushStatsBuffer();
        const groupId = getGroupId(message);
        const stats = await queryStats(groupId, todayStr());
        const title = groupId ? "今日本群消息统计" : "今日全局消息统计";
        const data = buildStatsRankReportData(
          stats,
          title,
          cfg.rankSize,
          String(message.$sender?.id || ""),
        );
        return statsRankReply(data);
      }),
  );

  addCommand(
    new MessageCommand("stats-week")
      .desc("周消息统计", "查看本周消息统计")
      .action(async (message) => {
        await flushStatsBuffer();
        const groupId = getGroupId(message);
        const stats = await queryStats(groupId, weekStartStr());
        const title = groupId ? "本周本群消息统计" : "本周全局消息统计";
        const data = buildStatsRankReportData(
          stats,
          title,
          cfg.rankSize,
          String(message.$sender?.id || ""),
        );
        return statsRankReply(data);
      }),
  );

  addCommand(
    new MessageCommand("stats-rank")
      .desc("话唠排行", "查看活跃度排行榜")
      .action(async (message) => {
        await flushStatsBuffer();
        const groupId = getGroupId(message);
        const stats = await queryStats(groupId, monthStartStr());
        const title = groupId ? "本月话唠排行" : "全局话唠排行";
        const data = buildStatsRankReportData(
          stats,
          title,
          cfg.rankSize,
          String(message.$sender?.id || ""),
        );
        return statsRankReply(data);
      }),
  );

  addCommand(
    new MessageCommand("mystats")
      .desc("我的统计", "查看个人消息统计")
      .action(async (message) => {
        await flushStatsBuffer();
        const M = getStatsModel();
        if (!M) return "统计数据库尚未就绪";
        const userId = String(message.$sender?.id || "");
        if (!userId) return "无法获取用户信息";
        const groupId = getGroupId(message);
        const rows: any[] = groupId
          ? await M.select().where({ user_id: userId, group_id: groupId })
          : await M.select().where({ user_id: userId });
        if (rows.length === 0) return "暂无你的消息记录";
        const today = todayStr();
        const weekStart = weekStartStr();
        const monthStart = monthStartStr();
        let todayCount = 0;
        let weekCount = 0;
        let monthCount = 0;
        let totalCount = 0;
        for (const row of rows) {
          const c = row.count || 0;
          totalCount += c;
          if (row.date >= monthStart) monthCount += c;
          if (row.date >= weekStart) weekCount += c;
          if (row.date === today) todayCount += c;
        }
        const scope = groupId ? "本群" : "全局";
        const data: MyStatsReportData = {
          userName: String(message.$sender?.name || "你"),
          scope,
          todayCount,
          weekCount,
          monthCount,
          totalCount,
          activeDays: rows.length,
        };
        return myStatsReply(data);
      }),
  );

  const cleanupTimer = setInterval(async () => {
    const M = getStatsModel();
    if (!M) return;
    try {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - cfg.statsRetentionDays);
      const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
      const all: any[] = await M.select();
      for (const row of all.filter((r) => r.date < cutoffStr)) {
        await M.delete().where({
          user_id: row.user_id,
          group_id: row.group_id,
          date: row.date,
        });
      }
    } catch {
      /* ignore */
    }
  }, 24 * 60 * 60_000);

  onDispose(() => clearInterval(cleanupTimer));

  logger.debug(
    formatCompact({
      模块: "消息统计",
      状态: "已加载",
      排行榜大小: cfg.rankSize,
      数据保留天数: cfg.statsRetentionDays,
    }),
  );
}
