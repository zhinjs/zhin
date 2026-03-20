/**
 * @zhin.js/plugin-group-daily-analysis
 *
 * 群日常分析插件：基于 zhin 内置收件箱（unified_inbox_message）做群聊统计与可选 LLM 分析。
 * 功能灵感与参考：https://github.com/SXP-Simon/astrbot_plugin_qq_group_daily_analysis
 * 另见：https://github.com/LSTM-Kirigaya/openmcp-tutorial/tree/main/qq-group-summary
 *
 * 依赖：主配置中启用 inbox.enabled 与 database。
 * 命令：/群分析 [天数]、/分析设置 enable|disable|status
 */
import { usePlugin, MessageCommand, Schema, Cron,segment } from "zhin.js";
import type { InboxMessageRow } from "./analysis.js";
import type {} from "@zhin.js/plugin-html-renderer";
import {
  computeBasicStats,
  formatTextReport,
  appendLLMReport,
  parseLLMResponse,
  extractText,
  type AnalysisResult,
} from "./analysis.js";

const plugin = usePlugin();
const {
  logger,
  root,
  addCommand,
  useContext,
  addCron,
  onDispose,
  declareConfig,
} = plugin;

const INBOX_TABLE = "unified_inbox_message";
const SETTINGS_TABLE = "group_daily_analysis_settings";

// ─── 配置 ─────────────────────────────────────────────────────────────────────

const config = declareConfig(
  "group-daily-analysis",
  Schema.object({
    analysisDays: Schema.number()
      .default(1)
      .min(1)
      .max(30)
      .description("默认分析最近天数"),
    autoAnalysisEnabled: Schema.boolean()
      .default(false)
      .description("是否启用定时自动分析"),
    autoAnalysisCron: Schema.string()
      .default("0 9 * * *")
      .description("每日分析 Cron（默认每天 9 点）"),
    enabledGroups: Schema.list(Schema.string())
      .default([])
      .description("启用分析的群 ID 白名单（空表示不限制）"),
    disabledGroups: Schema.list(Schema.string())
      .default([])
      .description("禁用分析的群 ID 黑名单"),
    outputFormat: Schema.string()
      .default("text")
      .description("报告输出格式：text 或 image（需 html-renderer）"),
    maxMessagesPerAnalysis: Schema.number()
      .default(500)
      .min(100)
      .max(5000)
      .description("单次分析使用的最大消息条数"),
  })
);

// ─── 数据库与收件箱 ───────────────────────────────────────────────────────────

let _db: any = null;
let _settingsModel: any = null;

function getInboxModel(): any {
  if (!_db) {
    const database = root.inject("database" as any) as any;
    if (database) _db = database;
  }
  return _db?.models?.get(INBOX_TABLE) ?? null;
}

function getSettingsModel(): any {
  return _db?.models?.get(SETTINGS_TABLE) ?? null;
}

function getChannelFromMessage(message: any): { channelId: string; channelType: string; adapter?: string; botId?: string } | null {
  const ch = message?.$channel;
  if (!ch?.id) return null;
  return {
    channelId: String(ch.id),
    channelType: String(ch.type || "private"),
    adapter: message?.$adapter,
    botId: message?.$bot,
  };
}

useContext("database", (db: any) => {
  _db = db;
  // 收件箱表由主包在 inbox.enabled 时注册，此处仅只读使用
  const inboxModel = db.models?.get(INBOX_TABLE);
  if (!inboxModel) {
    logger.warn("[group-daily-analysis] 未检测到收件箱表，请在主配置中启用 inbox.enabled 与 database");
  }
  // 本插件仅新增：群分析开关表（用于 /分析设置）
  if (typeof db.define === "function") {
    db.define(SETTINGS_TABLE, {
      id: { type: "integer", primary: true, autoIncrement: true },
      channel_id: { type: "text", nullable: false },
      channel_type: { type: "text", nullable: false },
      adapter: { type: "text", default: "" },
      bot_id: { type: "text", default: "" },
      enabled: { type: "integer", default: 1 },
      updated_at: { type: "text", default: "" },
    });
    logger.info("[group-daily-analysis] 分析设置表已注册");
  }
});

// ─── 群组是否参与分析（白名单/黑名单 + 分析设置）──────────────────────────────

function isGroupInList(groupId: string, list: string[]): boolean {
  return list.some((id) => id === groupId || id === String(groupId));
}

async function isAnalysisEnabledForChannel(
  channelId: string,
  channelType: string,
  adapter: string
): Promise<boolean> {
  if (channelType !== "group") return false;
  if (config.disabledGroups.length > 0 && isGroupInList(channelId, config.disabledGroups)) return false;
  if (config.enabledGroups.length > 0 && !isGroupInList(channelId, config.enabledGroups)) return false;
  const Settings = getSettingsModel();
  if (!Settings) return true;
  try {
    const rows: any[] = await Settings.select().where({
      channel_id: channelId,
      channel_type: channelType,
      adapter: adapter || "",
    });
    if (rows.length === 0) return true;
    return (rows[0].enabled ?? 1) === 1;
  } catch {
    return true;
  }
}

async function setAnalysisEnabledForChannel(
  channelId: string,
  channelType: string,
  adapter: string,
  botId: string,
  enabled: boolean
): Promise<void> {
  const Settings = getSettingsModel();
  if (!Settings) return;
  const ts = new Date().toISOString();
  const rows: any[] = await Settings.select().where({
    channel_id: channelId,
    channel_type: channelType,
    adapter: adapter || "",
  });
  if (rows.length > 0) {
    await Settings.update({
      enabled: enabled ? 1 : 0,
      updated_at: ts,
      bot_id: botId || rows[0].bot_id || "",
    }).where({ id: rows[0].id });
  } else {
    await Settings.insert({
      channel_id: channelId,
      channel_type: channelType,
      adapter: adapter || "",
      bot_id: botId || "",
      enabled: enabled ? 1 : 0,
      updated_at: ts,
    });
  }
}

// ─── 从收件箱查询消息并执行分析 ─────────────────────────────────────────────────

function getTimeRangeDays(days: number): { start: number; end: number; startStr: string; endStr: string } {
  const end = Date.now();
  const start = end - days * 24 * 60 * 60 * 1000;
  const dStart = new Date(start);
  const dEnd = new Date(end);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { start, end, startStr: fmt(dStart), endStr: fmt(dEnd) };
}

async function queryInboxMessages(
  channelId: string,
  adapter: string,
  botId: string,
  startTs: number,
  endTs: number,
  limit: number
): Promise<InboxMessageRow[]> {
  const Inbox = getInboxModel();
  if (!Inbox) return [];
  try {
    let rows: any[];
    try {
      rows = await Inbox.select()
        .where({
          channel_id: channelId,
          channel_type: "group",
          adapter: adapter || "",
          bot_id: botId || "",
          created_at: { $gte: startTs, $lte: endTs },
        })
        .orderBy("created_at", "ASC")
        .limit(limit);
    } catch {
      rows = await Inbox.select()
        .where({ channel_id: channelId, channel_type: "group", adapter: adapter || "", bot_id: botId || "" });
      rows = (rows || [])
        .filter((r: any) => r.created_at >= startTs && r.created_at <= endTs)
        .sort((a: any, b: any) => a.created_at - b.created_at)
        .slice(0, limit);
    }
    return rows as InboxMessageRow[];
  } catch (e) {
    logger.warn("[group-daily-analysis] 查询收件箱失败", (e as Error)?.message);
    return [];
  }
}

async function runAnalysis(
  channelId: string,
  channelName: string,
  adapter: string,
  botId: string,
  days: number
): Promise<AnalysisResult | string> {
  const Inbox = getInboxModel();
  if (!Inbox) {
    return "请先在配置中启用 inbox.enabled 并配置 database，以使用群日常分析。";
  }
  const { start, end, startStr, endStr } = getTimeRangeDays(days);
  const rows = await queryInboxMessages(
    channelId,
    adapter,
    botId,
    start,
    end,
    config.maxMessagesPerAnalysis
  );
  if (rows.length === 0) {
    return `在 ${startStr} 至 ${endStr} 区间内没有找到本群消息记录，请确认收件箱已启用并有过群消息。`;
  }
  const stats = computeBasicStats(rows);
  let textReport = formatTextReport(stats, {
    channelName: channelName || undefined,
    days,
    startDate: startStr,
    endDate: endStr,
  });

  // 可选：LLM 话题/金句/用户画像（灵感来自 astrbot_plugin_qq_group_daily_analysis）
  const ai = root.inject("ai" as any) as { ask?: (q: string, opts?: { systemPrompt?: string }) => Promise<string> } | undefined;
  if (ai?.ask) {
    try {
      const sampleSize = Math.min(rows.length, 150);
      const sample = rows.slice(-sampleSize);
      const conversation = sample
        .map((r) => `[${r.sender_name || r.sender_id}]: ${extractText(r).slice(0, 200)}`)
        .join("\n");
      const systemPrompt = `你是一个群聊分析助手。根据下面的群聊消息摘要，提取并仅返回一个 JSON 对象，包含以下三个数组（均为中文）：
- topics: 数组，每项 { "topic": "话题关键词", "summary": "简短说明" }
- quotes: 数组，每项 { "content": "金句原文", "sender": "发言人", "reason": "入选理由" }，最多 5 条
- user_titles: 数组，每项 { "name": "昵称", "user_id": "id", "title": "称号/画像", "reason": "理由" }，最多 8 人
不要输出除 JSON 以外的内容。`;
      const answer = await ai.ask(
        `请分析以下群聊片段并返回 JSON：\n\n${conversation.slice(0, 6000)}`,
        { systemPrompt }
      );
      if (answer && answer.trim()) {
        const llm = parseLLMResponse(answer);
        if (llm.topics?.length || llm.quotes?.length || llm.userTitles?.length) {
          textReport = appendLLMReport(textReport, llm);
        }
      }
    } catch (e) {
      logger.debug("[group-daily-analysis] LLM 分析跳过", (e as Error)?.message);
    }
  }

  return { stats, textReport };
}

// ─── 命令：群分析 ─────────────────────────────────────────────────────────────

addCommand(
  new MessageCommand("群分析 [天数:number]")
    .desc("群日常分析", "分析本群近期消息统计（依赖收件箱）")
    .action(async (message: any, result: any) => {
      const ch = getChannelFromMessage(message);
      if (!ch || ch.channelType !== "group") {
        return "请在群聊中使用本命令。";
      }
      const days = Math.min(30, Math.max(1, Number(result.params?.天数) || config.analysisDays));
      const channelName = (message?.$channel as { name?: string })?.name || "";
      const report = await runAnalysis(
        ch.channelId,
        channelName,
        ch.adapter || "",
        ch.botId || "",
        days
      );
      if (typeof report === "string") return report;
      if (config.outputFormat === "image") {
        const renderer = root.inject("html-renderer")
        if (renderer) {
          try {
            const escaped = report.textReport
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/\n/g, "<br/>");
            const html = `<div style="padding:20px;font-size:14px;line-height:1.5;white-space:pre-wrap;background:#fafafa;border-radius:8px;">${escaped}</div>`;
            const resultImg = await renderer.render(html);
            const base64 = (resultImg.data as Buffer).toString("base64");
            const dataUrl = `base64://${base64}`;
            return [segment("image", { url: dataUrl,name: "group-daily-analysis.png" })];
          } catch (e) {
            logger.debug("[group-daily-analysis] 图片渲染失败，回退文本", (e as Error)?.message);
          }
        }
      }
      return report.textReport;
    })
);

// ─── 命令：分析设置 ───────────────────────────────────────────────────────────

addCommand(
  new MessageCommand("分析设置 [操作:text]")
    .desc("分析设置", "enable=启用本群分析 / disable=禁用 / status=查看状态")
    .action(async (message: any, result: any) => {
      const ch = getChannelFromMessage(message);
      if (!ch || ch.channelType !== "group") {
        return "请在群聊中使用本命令。";
      }
      const op = (result.params?.操作 || "status").trim().toLowerCase();
      const adapter = ch.adapter || "";
      const botId = ch.botId || "";
      if (op === "enable") {
        await setAnalysisEnabledForChannel(ch.channelId, ch.channelType, adapter, botId, true);
        return "已为本群启用日常分析。";
      }
      if (op === "disable") {
        await setAnalysisEnabledForChannel(ch.channelId, ch.channelType, adapter, botId, false);
        return "已为本群关闭日常分析。";
      }
      if (op === "status") {
        const enabled = await isAnalysisEnabledForChannel(ch.channelId, ch.channelType, adapter);
        return `本群日常分析：${enabled ? "已启用" : "已关闭"}`;
      }
      return "用法：分析设置 enable | disable | status";
    })
);

// ─── 定时任务（可选）───────────────────────────────────────────────────────────

let cronDispose: (() => void) | null = null;

useContext("database", () => {
  if (!config.autoAnalysisEnabled || cronDispose) return;
  if (typeof addCron !== "function") return;
  try {
    cronDispose = addCron(
      new Cron(config.autoAnalysisCron, async () => {
        const inject = root.inject?.bind(root) as (key: string) => any;
        if (typeof inject !== "function") return;
        const targets: { channelId: string; adapter: string; botId: string }[] = [];
        const Settings = getSettingsModel();
        if (Settings) {
          const rows: any[] = await Settings.select().where({ channel_type: "group", enabled: 1 });
          for (const r of rows) {
            if (r.channel_id && r.adapter) targets.push({
              channelId: String(r.channel_id),
              adapter: String(r.adapter),
              botId: String(r.bot_id || ""),
            });
          }
        }
        for (const gid of config.enabledGroups) {
          if (targets.some((t) => t.channelId === gid)) continue;
          const adapters = (root as any).adapters as string[] | undefined;
          const adapterName = Array.isArray(adapters) && adapters[0] ? adapters[0] : "";
          if (adapterName) targets.push({ channelId: String(gid), adapter: adapterName, botId: "" });
        }
        for (const t of targets) {
          if (config.disabledGroups.length && isGroupInList(t.channelId, config.disabledGroups)) continue;
          try {
            const report = await runAnalysis(t.channelId, "", t.adapter, t.botId, config.analysisDays);
            if (typeof report === "string") continue;
            const adapter = inject(t.adapter);
            if (adapter?.sendMessage) {
              let botId = t.botId;
              if (!botId && adapter.bots?.size) {
                const first = adapter.bots.values().next().value;
                botId = first?.$id ?? first?.selfId ?? "";
              }
              await adapter.sendMessage({
                context: t.adapter,
                bot: botId,
                type: "group",
                id: t.channelId,
                content: report.textReport,
              }).catch(() => {});
            }
          } catch (e) {
            logger.warn("[group-daily-analysis] 定时分析发送失败", t.channelId, (e as Error)?.message);
          }
        }
      })
    );
    logger.info("[group-daily-analysis] 定时分析已注册: " + config.autoAnalysisCron);
  } catch (e) {
    logger.warn("[group-daily-analysis] 注册定时任务失败", (e as Error)?.message);
  }
});

onDispose(() => {
  if (cronDispose) {
    cronDispose();
    cronDispose = null;
  }
});

logger.info(
  `[group-daily-analysis] 已加载 (分析天数=${config.analysisDays}, 定时=${config.autoAnalysisEnabled ? config.autoAnalysisCron : "关"})`
);
