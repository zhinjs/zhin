/**
 * @zhin.js/plugin-checkin
 *
 * 签到积分插件 —— 每日签到、积分累积、连续签到奖励、排行榜
 *
 * 功能：
 *   - 每日签到获得随机积分
 *   - 连续签到天数追踪和额外奖励
 *   - 积分排行榜（群内 / 全局）
 *   - 积分查询
 *   - 数据库持久化
 *   - AI 工具集成
 *
 * 命令：
 *   checkin / 签到          每日签到
 *   mypoints / 我的积分     查看个人积分与签到信息
 *   rank / 排行榜           查看积分排行榜
 *
 * 配置（zhin.config.yml）：
 * ```yaml
 * plugins:
 *   - "@zhin.js/plugin-checkin"
 * checkin:
 *   basePointsMin: 10
 *   basePointsMax: 30
 *   streakBonus: 5
 *   streakCap: 50
 *   rankSize: 10
 * ```
 */
import { usePlugin, MessageCommand, Schema } from "zhin.js";

const plugin = usePlugin();
const { logger, root, addCommand, useContext, onDispose, declareConfig } = plugin;

const config = declareConfig("checkin", Schema.object({
  basePointsMin: Schema.number().default(10).min(1).max(100).description("基础积分最小值"),
  basePointsMax: Schema.number().default(30).min(1).max(200).description("基础积分最大值"),
  streakBonus: Schema.number().default(5).min(0).max(100).description("连续签到每天额外积分"),
  streakCap: Schema.number().default(50).min(0).max(500).description("连续奖励上限"),
  rankSize: Schema.number().default(10).min(3).max(50).description("排行榜显示人数"),
}));

export function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function yesterdayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function ts(): string {
  return new Date().toISOString();
}

// ─── 延迟数据库访问 ──────────────────────────────────────────────────────────

let _db: any = null;

export function getModel(): any {
  if (!_db) {
    const database = root.inject("database" as any) as any;
    if (database) _db = database;
  }
  return _db?.models?.get("checkin_records") ?? null;
}

useContext("database", (db: any) => {
  _db = db;
  db.define("checkin_records", {
    user_id: { type: "text", nullable: false },
    user_name: { type: "text", default: "" },
    points: { type: "integer", default: 0 },
    total_checkins: { type: "integer", default: 0 },
    streak: { type: "integer", default: 0 },
    max_streak: { type: "integer", default: 0 },
    last_checkin: { type: "text", default: "" },
    context_type: { type: "text", default: "global" },
    context_id: { type: "text", default: "" },
    created_at: { type: "text", default: "" },
    updated_at: { type: "text", default: "" },
  });
  logger.info("签到模型已注册");
});

// ─── 辅助 ────────────────────────────────────────────────────────────────────

function getContextKey(message: any): { type: string; id: string } {
  if (message.type === "group") {
    return { type: "group", id: String(message.$group?.id || message.$target?.id || "") };
  }
  return { type: "global", id: "" };
}

async function getOrCreateUser(model: any, userId: string, userName: string, ctxType: string, ctxId: string): Promise<any> {
  const rows: any[] = await model.select().where({ user_id: userId, context_type: ctxType, context_id: ctxId });
  if (rows.length > 0) return rows[0];

  await model.insert({
    user_id: userId,
    user_name: userName,
    points: 0,
    total_checkins: 0,
    streak: 0,
    max_streak: 0,
    last_checkin: "",
    context_type: ctxType,
    context_id: ctxId,
    created_at: ts(),
    updated_at: ts(),
  });

  const created: any[] = await model.select().where({ user_id: userId, context_type: ctxType, context_id: ctxId });
  return created[0] || null;
}

// ─── 命令：签到 ──────────────────────────────────────────────────────────────

addCommand(
  new MessageCommand("checkin")
    .desc("签到", "每日签到获得积分")
    .action(async (message: any) => {
      const M = getModel();
      if (!M) return "签到数据库尚未就绪，请稍后重试";

      const userId = String(message.$sender?.id || "");
      const userName = String(message.$sender?.name || "用户");
      if (!userId) return "无法获取用户信息";

      const { type: ctxType, id: ctxId } = getContextKey(message);
      const user = await getOrCreateUser(M, userId, userName, ctxType, ctxId);
      if (!user) return "签到失败，请重试";

      const today = todayStr();
      if (user.last_checkin === today) {
        return `你今天已经签到过了哦～\n当前积分: ${user.points}\n连续签到: ${user.streak} 天`;
      }

      const yesterday = yesterdayStr();
      const isConsecutive = user.last_checkin === yesterday;
      const newStreak = isConsecutive ? user.streak + 1 : 1;

      const base = randomInt(config.basePointsMin, config.basePointsMax);
      const bonus = Math.min(newStreak * config.streakBonus, config.streakCap);
      const earned = base + bonus;
      const newPoints = (user.points || 0) + earned;
      const newTotal = (user.total_checkins || 0) + 1;
      const newMaxStreak = Math.max(user.max_streak || 0, newStreak);

      await M.update({
        points: newPoints,
        total_checkins: newTotal,
        streak: newStreak,
        max_streak: newMaxStreak,
        last_checkin: today,
        user_name: userName,
        updated_at: ts(),
      }).where({ id: user.id });

      const lines = [
        `签到成功！`,
        `基础积分: +${base}`,
      ];
      if (bonus > 0) lines.push(`连续奖励: +${bonus} (连续${newStreak}天)`);
      lines.push(`本次获得: +${earned}`);
      lines.push(`当前积分: ${newPoints}`);
      if (newStreak >= 7) lines.push(`连续签到 ${newStreak} 天，太棒了！`);

      return lines.join("\n");
    }),
);

// ─── 命令：我的积分 ──────────────────────────────────────────────────────────

addCommand(
  new MessageCommand("mypoints")
    .desc("我的积分", "查看个人积分与签到信息")
    .action(async (message: any) => {
      const M = getModel();
      if (!M) return "签到数据库尚未就绪";

      const userId = String(message.$sender?.id || "");
      const { type: ctxType, id: ctxId } = getContextKey(message);

      const rows: any[] = await M.select().where({ user_id: userId, context_type: ctxType, context_id: ctxId });
      if (rows.length === 0) return "你还没有签到记录哦，发送「签到」开始吧！";

      const u = rows[0];
      const today = todayStr();
      const checkedToday = u.last_checkin === today;

      const lines = [
        `${u.user_name || "用户"} 的积分信息`,
        `积分: ${u.points}`,
        `累计签到: ${u.total_checkins} 天`,
        `连续签到: ${u.streak} 天`,
        `最长连续: ${u.max_streak} 天`,
        checkedToday ? "今日已签到 ✓" : "今日未签到",
      ];

      return lines.join("\n");
    }),
);

// ─── 命令：排行榜 ─────────────────────────────────────────────────────────────

addCommand(
  new MessageCommand("rank")
    .desc("积分排行", "查看积分排行榜")
    .action(async (message: any) => {
      const M = getModel();
      if (!M) return "签到数据库尚未就绪";

      const { type: ctxType, id: ctxId } = getContextKey(message);

      const all: any[] = await M.select().where(
        ctxType === "global"
          ? { context_type: "global" }
          : { context_type: ctxType, context_id: ctxId },
      );

      if (all.length === 0) return "还没有人签到过哦～";

      const sorted = all.sort((a: any, b: any) => (b.points || 0) - (a.points || 0));
      const top = sorted.slice(0, config.rankSize);

      const medals = ["🥇", "🥈", "🥉"];
      const lines = top.map((u: any, i: number) => {
        const prefix = i < 3 ? medals[i] : `${i + 1}.`;
        return `${prefix} ${u.user_name || u.user_id} — ${u.points}分 (${u.total_checkins}天)`;
      });

      const title = ctxType === "group" ? "本群积分排行" : "全局积分排行";
      const userId = String(message.$sender?.id || "");
      const myRank = sorted.findIndex((u: any) => u.user_id === userId);
      const footer = myRank >= 0 ? `\n你的排名: 第${myRank + 1}名` : "";

      return `${title}\n${lines.join("\n")}${footer}`;
    }),
);

// AI 工具已迁移到 tools/*.tool.md，框架自动发现注册

logger.info(`插件已加载 (基础积分=${config.basePointsMin}~${config.basePointsMax}, 连续奖励=${config.streakBonus}/天)`);
