/**
 * @zhin.js/plugin-stats
 *
 * 消息统计插件 —— 按用户/群维度统计消息量，支持日/周/月报表
 *
 * 功能：
 *   - 中间件自动计数（不干扰消息处理）
 *   - 按群、按用户维度统计
 *   - 支持今日/本周/本月报表
 *   - 活跃排行榜（话唠排行）
 *   - 数据库持久化
 *   - AI 工具集成
 *
 * 命令：
 *   stats / 消息统计         查看今日消息统计
 *   stats-week / 周报        查看本周统计
 *   stats-rank / 话唠排行    查看活跃度排行
 *   mystats / 我的统计       查看个人统计
 *
 * 配置（zhin.config.yml）：
 * ```yaml
 * plugins:
 *   - "@zhin.js/plugin-stats"
 * stats:
 *   rankSize: 10
 *   retentionDays: 90
 * ```
 */
import { usePlugin, ZhinTool, MessageCommand, Schema } from "zhin.js";

const plugin = usePlugin();
const { logger, root, addCommand, addMiddleware, useContext, onDispose, declareSkill, declareConfig } = plugin;

const config = declareConfig("stats", Schema.object({
  rankSize: Schema.number().default(10).min(3).max(50).description("排行榜显示人数"),
  retentionDays: Schema.number().default(90).min(7).max(365).description("数据保留天数"),
}));

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function weekStartStr(): string {
  const d = new Date();
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function monthStartStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function ts(): string {
  return new Date().toISOString();
}

// ─── 延迟数据库 ──────────────────────────────────────────────────────────────

let _db: any = null;

function getModel(): any {
  if (!_db) {
    const database = root.inject("database" as any) as any;
    if (database) _db = database;
  }
  return _db?.models?.get("message_stats") ?? null;
}

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
  logger.info("消息统计模型已注册");
});

// ─── 辅助 ────────────────────────────────────────────────────────────────────

function getGroupId(message: any): string {
  if (message.type === "group") {
    return String(message.$group?.id || message.$target?.id || "");
  }
  return "";
}

// ─── 写入缓冲（批量写入减少 IO）─────────────────────────────────────────────

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

async function flushBuffer(): Promise<void> {
  const M = getModel();
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
        }).where({ id: existing[0].id });
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
      // 单条失败不影响其他
    }
  }
}

const flushTimer = setInterval(flushBuffer, 10_000);
onDispose(async () => {
  clearInterval(flushTimer);
  await flushBuffer();
  buffer.clear();
});

// ─── 中间件：计数 ────────────────────────────────────────────────────────────

addMiddleware(async function statsCounter(message: any, next: () => Promise<void>) {
  const userId = String(message.$sender?.id || "");
  if (!userId) return next();

  const userName = String(message.$sender?.name || "");
  const groupId = getGroupId(message);
  const date = todayStr();
  const key = bufferKey(userId, groupId, date);

  const pending = buffer.get(key);
  if (pending) {
    pending.count++;
    pending.user_name = userName;
  } else {
    buffer.set(key, { user_id: userId, user_name: userName, group_id: groupId, date, count: 1 });
  }

  return next();
});

// ─── 查询辅助 ─────────────────────────────────────────────────────────────────

async function queryStats(groupId: string, fromDate: string): Promise<Map<string, { name: string; count: number }>> {
  const M = getModel();
  if (!M) return new Map();

  let all: any[];
  if (groupId) {
    all = await M.select().where({ group_id: groupId });
  } else {
    all = await M.select();
  }

  const result = new Map<string, { name: string; count: number }>();
  for (const row of all) {
    if (row.date < fromDate) continue;
    const existing = result.get(row.user_id);
    if (existing) {
      existing.count += row.count || 0;
      if (row.user_name) existing.name = row.user_name;
    } else {
      result.set(row.user_id, { name: row.user_name || row.user_id, count: row.count || 0 });
    }
  }

  return result;
}

function formatRank(stats: Map<string, { name: string; count: number }>, title: string, size: number, myUserId?: string): string {
  const sorted = [...stats.entries()].sort((a, b) => b[1].count - a[1].count);
  const total = sorted.reduce((s, [, v]) => s + v.count, 0);
  const top = sorted.slice(0, size);

  if (top.length === 0) return `${title}\n暂无数据`;

  const medals = ["🥇", "🥈", "🥉"];
  const lines = top.map(([, v], i) => {
    const prefix = i < 3 ? medals[i] : `${i + 1}.`;
    return `${prefix} ${v.name} — ${v.count}条`;
  });

  let footer = `\n共 ${stats.size} 人, ${total} 条消息`;
  if (myUserId) {
    const myRank = sorted.findIndex(([uid]) => uid === myUserId);
    if (myRank >= 0) {
      footer += ` | 你第${myRank + 1}名 (${sorted[myRank][1].count}条)`;
    }
  }

  return `${title}\n${lines.join("\n")}${footer}`;
}

// ─── 命令：stats（今日统计）─────────────────────────────────────────────────

addCommand(
  new MessageCommand("stats")
    .desc("消息统计", "查看今日消息统计")
    .action(async (message: any) => {
      await flushBuffer();
      const groupId = getGroupId(message);
      const stats = await queryStats(groupId, todayStr());
      const title = groupId ? "今日本群消息统计" : "今日全局消息统计";
      const userId = String(message.$sender?.id || "");
      return formatRank(stats, title, config.rankSize, userId);
    }),
);

// ─── 命令：stats-week（本周统计）─────────────────────────────────────────────

addCommand(
  new MessageCommand("stats-week")
    .desc("周消息统计", "查看本周消息统计")
    .action(async (message: any) => {
      await flushBuffer();
      const groupId = getGroupId(message);
      const stats = await queryStats(groupId, weekStartStr());
      const title = groupId ? "本周本群消息统计" : "本周全局消息统计";
      const userId = String(message.$sender?.id || "");
      return formatRank(stats, title, config.rankSize, userId);
    }),
);

// ─── 命令：stats-rank（话唠排行）──────────────────────────────────────────────

addCommand(
  new MessageCommand("stats-rank")
    .desc("话唠排行", "查看活跃度排行榜")
    .action(async (message: any) => {
      await flushBuffer();
      const groupId = getGroupId(message);
      const stats = await queryStats(groupId, monthStartStr());
      const title = groupId ? "本月话唠排行" : "全局话唠排行";
      const userId = String(message.$sender?.id || "");
      return formatRank(stats, title, config.rankSize, userId);
    }),
);

// ─── 命令：mystats（个人统计）─────────────────────────────────────────────────

addCommand(
  new MessageCommand("mystats")
    .desc("我的统计", "查看个人消息统计")
    .action(async (message: any) => {
      await flushBuffer();
      const M = getModel();
      if (!M) return "统计数据库尚未就绪";

      const userId = String(message.$sender?.id || "");
      if (!userId) return "无法获取用户信息";

      const groupId = getGroupId(message);

      let rows: any[];
      if (groupId) {
        rows = await M.select().where({ user_id: userId, group_id: groupId });
      } else {
        rows = await M.select().where({ user_id: userId });
      }

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

      const activeDays = rows.length;
      const scope = groupId ? "本群" : "全局";

      const lines = [
        `${message.$sender?.name || "你"} 的${scope}消息统计`,
        `今日: ${todayCount} 条`,
        `本周: ${weekCount} 条`,
        `本月: ${monthCount} 条`,
        `总计: ${totalCount} 条`,
        `活跃天数: ${activeDays} 天`,
      ];

      return lines.join("\n");
    }),
);

// ─── AI 工具 ─────────────────────────────────────────────────────────────────

plugin.addTool(
  new ZhinTool("stats_query")
    .desc("查询消息统计数据")
    .param("group_id", { type: "string", description: "群ID（可选，不填查全局）" })
    .param("period", { type: "string", description: "时段: today/week/month（默认today）" })
    .execute(async (args: Record<string, any>) => {
      await flushBuffer();
      const groupId = (args.group_id as string) || "";
      const period = (args.period as string) || "today";

      let fromDate: string;
      switch (period) {
        case "week": fromDate = weekStartStr(); break;
        case "month": fromDate = monthStartStr(); break;
        default: fromDate = todayStr(); break;
      }

      const stats = await queryStats(groupId, fromDate);
      if (stats.size === 0) return `${period} 暂无消息统计数据`;

      const sorted = [...stats.entries()].sort((a, b) => b[1].count - a[1].count);
      const total = sorted.reduce((s, [, v]) => s + v.count, 0);

      const top10 = sorted.slice(0, 10);
      const lines = top10.map(([, v], i) => `${i + 1}. ${v.name} — ${v.count}条`);

      return `消息统计 (${period})\n总消息: ${total}条, 活跃用户: ${stats.size}人\n${lines.join("\n")}`;
    })
    .toTool(),
);

plugin.addTool(
  new ZhinTool("stats_user")
    .desc("查询指定用户的消息统计")
    .param("user_id", { type: "string", description: "用户ID" })
    .execute(async (args: Record<string, any>) => {
      await flushBuffer();
      const M = getModel();
      if (!M) return "统计数据库尚未就绪";

      const userId = args.user_id as string;
      if (!userId) return "请提供用户ID";

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
    })
    .toTool(),
);

// ─── 数据清理（定期删除过期数据）──────────────────────────────────────────────

const cleanupTimer = setInterval(async () => {
  const M = getModel();
  if (!M) return;
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - config.retentionDays);
    const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;

    const all: any[] = await M.select();
    const expired = all.filter((r: any) => r.date < cutoffStr);
    for (const row of expired) {
      await M.delete().where({ id: row.id });
    }
    if (expired.length > 0) {
      logger.info(`清理了 ${expired.length} 条过期记录`);
    }
  } catch {
    // 清理失败不影响正常运行
  }
}, 24 * 60 * 60_000);

onDispose(() => clearInterval(cleanupTimer));

// ─── Skill 声明 ──────────────────────────────────────────────────────────────

declareSkill({
  description: "消息统计系统：自动追踪每个用户和群聊的消息数量，支持日/周/月维度查看，提供活跃度排行和个人统计。AI 可查询统计数据。",
  keywords: [
    "stats", "统计", "消息统计", "话唠",
    "rank", "排行", "活跃",
    "mystats", "我的统计",
    "week", "周报",
  ],
  tags: ["stats", "analytics", "message"],
});

logger.info(`插件已加载 (排行数=${config.rankSize}, 保留天数=${config.retentionDays})`);
