import { formatCompact, MessageCommand, type Plugin } from "zhin.js";
import type { GroupSuiteConfig } from "./config.js";
import { getDatabase, getMessageContextKey, todayStr, ts } from "./shared.js";

function yesterdayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

let _db: any = null;

export function getCheckinModel(): any {
  return _db?.models?.get("checkin_records") ?? null;
}

export function registerCheckin(plugin: Plugin, cfg: GroupSuiteConfig): void {
  const { logger, addCommand, useContext } = plugin;

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
    logger.info(formatCompact({ 模块: "签到", 数据模型: "已就绪" }));
  });

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
      last_checkin: "",
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

  addCommand(
    new MessageCommand("checkin")
      .desc("签到", "每日签到获得积分")
      .action(async (message) => {
        const M = getCheckinModel();
        if (!M) return "签到数据库尚未就绪，请稍后重试";

        const userId = String(message.$sender?.id || "");
        const userName = String(message.$sender?.name || "用户");
        if (!userId) return "无法获取用户信息";

        const { type: ctxType, id: ctxId } = getMessageContextKey(message);
        const user = await getOrCreateUser(M, userId, userName, ctxType, ctxId);
        if (!user) return "签到失败，请重试";

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
        return lines.join("\n");
      }),
  );

  addCommand(
    new MessageCommand("mypoints")
      .desc("我的积分", "查看个人积分与签到信息")
      .action(async (message) => {
        const M = getCheckinModel();
        if (!M) return "签到数据库尚未就绪";
        const userId = String(message.$sender?.id || "");
        const { type: ctxType, id: ctxId } = getMessageContextKey(message);
        const rows = (await M.select().where({
          user_id: userId,
          context_type: ctxType,
          context_id: ctxId,
        })) as Record<string, unknown>[];
        if (rows.length === 0) return "你还没有签到记录哦，发送「签到」开始吧！";
        const u = rows[0];
        const checkedToday = u.last_checkin === todayStr();
        return [
          `${u.user_name || "用户"} 的积分信息`,
          `积分: ${u.points}`,
          `累计签到: ${u.total_checkins} 天`,
          `连续签到: ${u.streak} 天`,
          `最长连续: ${u.max_streak} 天`,
          checkedToday ? "今日已签到 ✓" : "今日未签到",
        ].join("\n");
      }),
  );

  addCommand(
    new MessageCommand("rank")
      .desc("积分排行", "查看积分排行榜")
      .action(async (message) => {
        const M = getCheckinModel();
        if (!M) return "签到数据库尚未就绪";
        const { type: ctxType, id: ctxId } = getMessageContextKey(message);
        const all = (await M.select().where(
          ctxType === "global"
            ? { context_type: "global" }
            : { context_type: ctxType, context_id: ctxId },
        )) as Record<string, unknown>[];
        if (all.length === 0) return "还没有人签到过哦～";
        const sorted = all.sort(
          (a, b) => Number(b.points || 0) - Number(a.points || 0),
        );
        const top = sorted.slice(0, cfg.rankSize);
        const medals = ["🥇", "🥈", "🥉"];
        const lines = top.map((u, i) => {
          const prefix = i < 3 ? medals[i] : `${i + 1}.`;
          return `${prefix} ${u.user_name || u.user_id} — ${u.points}分 (${u.total_checkins}天)`;
        });
        const title = ctxType === "group" ? "本群积分排行" : "全局积分排行";
        const userId = String(message.$sender?.id || "");
        const myRank = sorted.findIndex((u) => u.user_id === userId);
        const footer = myRank >= 0 ? `\n你的排名: 第${myRank + 1}名` : "";
        return `${title}\n${lines.join("\n")}${footer}`;
      }),
  );

  if (!_db) {
    const db = getDatabase(plugin);
    if (db) _db = db;
  }

  logger.info(
    formatCompact({
      模块: "签到",
      状态: "已加载",
      基础积分最小值: cfg.basePointsMin,
      基础积分最大值: cfg.basePointsMax,
    }),
  );
}
