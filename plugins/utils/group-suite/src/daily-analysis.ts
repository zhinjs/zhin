/**
 * 群日常分析（group-suite 子模块）
 */
import { formatCompact, MessageCommand, segment, type Plugin } from "zhin.js";
import type { InboxMessageRow } from "./analysis.js";
import {
  buildAnalysisReportData,
  computeBasicStats,
  formatTextReport,
  appendLLMReport,
  parseLLMResponse,
  extractText,
  type AnalysisResult,
  type LLMAnalysis,
} from "./analysis.js";
import { buildAnalysisReportHtml, ANALYSIS_REPORT_CANVAS } from "./analysis-card.js";

const INBOX_TABLE = "unified_inbox_message";
const SETTINGS_TABLE = "group_daily_analysis_settings";

import type { GroupSuiteConfig } from "./config.js";

export function registerDailyAnalysis(
  plugin: Plugin,
  config: GroupSuiteConfig,
): void {
  const { logger, root, addCommand, useContext, addSchedule, onDispose } = plugin;

// ─── 数据库与收件箱 ───────────────────────────────────────────────────────────

let _db: any = null;
const _settingsModel: any = null;

function getInboxModel(): any {
  if (!_db) {
    const database = root.inject("database");
    if (database) _db = database;
  }
  return _db?.models?.get(INBOX_TABLE) ?? null;
}

function getSettingsModel(): any {
  return _db?.models?.get(SETTINGS_TABLE) ?? null;
}

function getChannelFromMessage(
  message: any,
): {
  channelId: string;
  channelType: string;
  adapter?: string;
  endpointId?: string;
} | null {
  const ch = message?.$channel;
  if (!ch?.id) return null;
  return {
    channelId: String(ch.id),
    channelType: String(ch.type || "private"),
    adapter: message?.$adapter,
    endpointId: message?.$endpoint,
  };
}

useContext("database", (db) => {
  _db = db;
  db.define(SETTINGS_TABLE, {
    id: { type: "integer", primary: true, autoIncrement: true },
    channel_id: { type: "text", nullable: false },
    channel_type: { type: "text", nullable: false },
    adapter: { type: "text", default: "" },
    endpoint_id: { type: "text", default: "" },
    enabled: { type: "integer", default: 1 },
    updated_at: { type: "text", default: "" },
  });
});

// ─── 群组是否参与分析（白名单/黑名单 + 分析设置）──────────────────────────────

function isGroupInList(groupId: string, list: string[]): boolean {
  return list.some((id) => id === groupId || id === String(groupId));
}

async function isAnalysisEnabledForChannel(
  channelId: string,
  channelType: string,
  adapter: string,
): Promise<boolean> {
  if (channelType !== "group") return false;
  if (
    config.analysisGroupsBlock.length > 0 &&
    isGroupInList(channelId, config.analysisGroupsBlock)
  )
    return false;
  if (
    config.analysisGroups.length > 0 &&
    !isGroupInList(channelId, config.analysisGroups)
  )
    return false;
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
  endpointId: string,
  enabled: boolean,
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
      endpoint_id: endpointId || rows[0].endpoint_id || "",
    }).where({ id: rows[0].id });
  } else {
    await Settings.insert({
      channel_id: channelId,
      channel_type: channelType,
      adapter: adapter || "",
      endpoint_id: endpointId || "",
      enabled: enabled ? 1 : 0,
      updated_at: ts,
    });
  }
}

// ─── 从收件箱查询消息并执行分析 ─────────────────────────────────────────────────

function getTimeRangeDays(days: number): {
  start: number;
  end: number;
  startStr: string;
  endStr: string;
} {
  const end = Date.now();
  const start = end - days * 24 * 60 * 60 * 1000;
  const dStart = new Date(start);
  const dEnd = new Date(end);
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;
  return { start, end, startStr: fmt(dStart), endStr: fmt(dEnd) };
}

async function queryInboxMessages(
  channelId: string,
  adapter: string,
  endpointId: string,
  startTs: number,
  endTs: number,
  limit: number,
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
          endpoint_id: endpointId || "",
          created_at: { $gte: startTs, $lte: endTs },
        })
        .orderBy("created_at", "ASC")
        .limit(limit);
    } catch {
      rows = await Inbox.select().where({
        channel_id: channelId,
        channel_type: "group",
        adapter: adapter || "",
        endpoint_id: endpointId || "",
      });
      rows = (rows || [])
        .filter((r: any) => r.created_at >= startTs && r.created_at <= endTs)
        .sort((a: any, b: any) => a.created_at - b.created_at)
        .slice(0, limit);
    }
    return rows as InboxMessageRow[];
  } catch (e) {
    logger.warn(formatCompact( { op: "inbox", ok: false, error: (e as Error)?.message }));
    return [];
  }
}

async function runAnalysis(
  channelId: string,
  channelName: string,
  adapter: string,
  endpointId: string,
  days: number,
): Promise<AnalysisResult | string> {
  const Inbox = getInboxModel();
  if (!Inbox) {
    return "请先在配置中启用 inbox.enabled 并配置 database，以使用群日常分析。";
  }
  const { start, end, startStr, endStr } = getTimeRangeDays(days);
  const rows = await queryInboxMessages(
    channelId,
    adapter,
    endpointId,
    start,
    end,
    config.analysisMaxMessages,
  );
  if (rows.length === 0) {
    return `在 ${startStr} 至 ${endStr} 区间内没有找到本群消息记录，请确认收件箱已启用并有过群消息。`;
  }
  const stats = computeBasicStats(rows);
  const meta = {
    channelName: channelName || undefined,
    days,
    startDate: startStr,
    endDate: endStr,
  };
  let textReport = formatTextReport(stats, meta);
  let llm: LLMAnalysis | undefined;

  // 可选：LLM 话题/金句/用户画像（灵感来自 astrbot_plugin_qq_group_daily_analysis）
  const ai = root.inject("ai") as
    | { ask?: (q: string, opts?: { systemPrompt?: string }) => Promise<string> }
    | undefined;
  if (ai?.ask) {
    try {
      const sampleSize = Math.min(rows.length, 150);
      const sample = rows.slice(-sampleSize);
      const conversation = sample
        .map(
          (r) =>
            `[${r.sender_name || r.sender_id}]: ${extractText(r).slice(
              0,
              200,
            )}`,
        )
        .join("\n");
      const systemPrompt = `你是一个群聊分析助手。根据下面的群聊消息摘要，提取并仅返回一个 JSON 对象，包含以下三个数组（均为中文）：
- topics: 数组，每项 { "topic": "话题关键词", "summary": "简短说明" }
- quotes: 数组，每项 { "content": "金句原文", "sender": "发言人", "reason": "入选理由" }，最多 5 条
- user_titles: 数组，每项 { "name": "昵称", "user_id": "id", "title": "称号/画像", "reason": "理由" }，最多 8 人
不要输出除 JSON 以外的内容。`;
      const answer = await ai.ask(
        `请分析以下群聊片段并返回 JSON：\n\n${conversation.slice(0, 6000)}`,
        { systemPrompt },
      );
      if (answer && answer.trim()) {
        const parsed = parseLLMResponse(answer);
        if (
          parsed.topics?.length ||
          parsed.quotes?.length ||
          parsed.userTitles?.length
        ) {
          llm = parsed;
          textReport = appendLLMReport(textReport, llm);
        }
      }
    } catch (e) {
      logger.debug("[LLM 分析跳过", (e as Error)?.message);
    }
  }

  return { stats, textReport, llm, meta };
}

function analysisReportReply(report: AnalysisResult) {
  return segment.html({
    html: buildAnalysisReportHtml(buildAnalysisReportData(report.stats, report.meta, report.llm)),
    width: 540,
    backgroundColor: ANALYSIS_REPORT_CANVAS,
    fileName: "group-daily-analysis.png",
  });
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
      const days = Math.min(
        30,
        Math.max(1, Number(result.params?.天数) || config.analysisDays),
      );
      const channelName = (message?.$channel as { name?: string })?.name || "";
      const report = await runAnalysis(
        ch.channelId,
        channelName,
        ch.adapter || "",
        ch.endpointId || "",
        days,
      );
      if (typeof report === "string") return report;
      return analysisReportReply(report);
    }),
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
      const endpointId = ch.endpointId || "";
      if (op === "enable") {
        await setAnalysisEnabledForChannel(
          ch.channelId,
          ch.channelType,
          adapter,
          endpointId,
          true,
        );
        return "已为本群启用日常分析。";
      }
      if (op === "disable") {
        await setAnalysisEnabledForChannel(
          ch.channelId,
          ch.channelType,
          adapter,
          endpointId,
          false,
        );
        return "已为本群关闭日常分析。";
      }
      if (op === "status") {
        const enabled = await isAnalysisEnabledForChannel(
          ch.channelId,
          ch.channelType,
          adapter,
        );
        return `本群日常分析：${enabled ? "已启用" : "已关闭"}`;
      }
      return "用法：分析设置 enable | disable | status";
    }),
);

// ─── 定时任务（可选）───────────────────────────────────────────────────────────

let scheduleDispose: (() => void) | null = null;

useContext("database", () => {
  if (!config.autoAnalysisEnabled || scheduleDispose) return;
  if (typeof addSchedule !== "function") return;
  try {
    scheduleDispose = addSchedule(
      { kind: 'solar', cron: config.autoAnalysisCron },
      async () => {
        const inject = root.inject?.bind(root) as (key: string) => any;
        if (typeof inject !== "function") return;
        const targets: { channelId: string; adapter: string; endpointId: string }[] =
          [];
        const Settings = getSettingsModel();
        if (Settings) {
          const rows: any[] = await Settings.select().where({
            channel_type: "group",
            enabled: 1,
          });
          for (const r of rows) {
            if (r.channel_id && r.adapter)
              targets.push({
                channelId: String(r.channel_id),
                adapter: String(r.adapter),
                endpointId: String(r.endpoint_id || ""),
              });
          }
        }
        for (const gid of config.analysisGroups) {
          if (targets.some((t) => t.channelId === gid)) continue;
          const adapters = (root as any).adapters as string[] | undefined;
          const adapterName =
            Array.isArray(adapters) && adapters[0] ? adapters[0] : "";
          if (adapterName)
            targets.push({
              channelId: String(gid),
              adapter: adapterName,
              endpointId: "",
            });
        }
        for (const t of targets) {
          if (
            config.analysisGroupsBlock.length &&
            isGroupInList(t.channelId, config.analysisGroupsBlock)
          )
            continue;
          try {
            const report = await runAnalysis(
              t.channelId,
              "",
              t.adapter,
              t.endpointId,
              config.analysisDays,
            );
            if (typeof report === "string") continue;
            const adapter = inject(t.adapter);
            if (adapter?.sendMessage) {
              let endpointId = t.endpointId;
              if (!endpointId && adapter.endpoints?.size) {
                const first = adapter.endpoints.values().next().value;
                endpointId = first?.$id ?? first?.selfId ?? "";
              }
              const content = analysisReportReply(report);
              await adapter
                .sendMessage({
                  context: t.adapter,
                  endpoint: endpointId,
                  type: "group",
                  id: t.channelId,
                  content,
                })
                .catch(() => {});
            }
          } catch (e) {
            logger.warn(formatCompact( { op: "send", channel: t.channelId, ok: false, error: (e as Error)?.message }));
          }
        }
      },
    );
  } catch (e) {
    logger.warn(formatCompact( { op: "schedule", ok: false, error: (e as Error)?.message }));
  }
});

onDispose(() => {
  if (scheduleDispose) {
    scheduleDispose();
    scheduleDispose = null;
  }
});
}
