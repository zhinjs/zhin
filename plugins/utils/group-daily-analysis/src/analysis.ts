/**
 * 群日常分析：从收件箱查询、基础统计、文本报告。
 * 数据源为 zhin 内置 unified_inbox_message 表（需 inbox.enabled）。
 *
 * 话题/金句/用户画像分析逻辑灵感来自：
 * https://github.com/SXP-Simon/astrbot_plugin_qq_group_daily_analysis
 */

export interface InboxMessageRow {
  id?: number;
  adapter: string;
  bot_id: string;
  channel_id: string;
  channel_type: string;
  sender_id: string;
  sender_name: string | null;
  content: string;
  /** 收件箱里可能是字符串，也可能被 ORM/驱动解析成对象 */
  raw: unknown;
  created_at: number;
}

export interface BasicStats {
  messageCount: number;
  participantCount: number;
  totalChars: number;
  hourlyDistribution: Record<number, number>;
  mostActiveHour: number;
}

/** 话题摘要（灵感来自 astrbot_plugin_qq_group_daily_analysis） */
export interface SummaryTopic {
  topic: string;
  summary?: string;
}

/** 金句（灵感来自 astrbot_plugin_qq_group_daily_analysis） */
export interface GoldenQuote {
  content: string;
  sender: string;
  reason: string;
}

/** 用户称号/画像（灵感来自 astrbot_plugin_qq_group_daily_analysis） */
export interface UserTitle {
  name: string;
  user_id: string;
  title: string;
  reason?: string;
}

export interface LLMAnalysis {
  topics: SummaryTopic[];
  quotes: GoldenQuote[];
  userTitles: UserTitle[];
}

export interface AnalysisResult {
  stats: BasicStats;
  textReport: string;
  llm?: LLMAnalysis;
}

/**
 * 从 content (JSON) 或 raw 提取纯文本，用于统计与 LLM
 */
export function extractText(row: InboxMessageRow): string {
  const raw = row.raw;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (t) return t;
  }
  // 非字符串 raw（如 icqq 存的对象）不走 trim，避免报错；改从 content 解析
  try {
    const c = row.content;
    const contentStr = typeof c === "string" ? c : JSON.stringify(c ?? []);
    const content = JSON.parse(contentStr || "[]");
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((part: any) => {
          if (part?.type === "text") {
            return part.data?.text ?? part.text ?? "";
          }
          return part?.text ?? "";
        })
        .filter(Boolean)
        .join("");
    }
  } catch {
    // ignore
  }
  return "";
}

/**
 * 计算基础统计：消息数、人数、总字数、按小时分布、最活跃时段
 */
export function computeBasicStats(rows: InboxMessageRow[]): BasicStats {
  const participantIds = new Set<string>();
  let totalChars = 0;
  const hourly: Record<number, number> = {};
  for (let h = 0; h < 24; h++) hourly[h] = 0;

  for (const row of rows) {
    participantIds.add(row.sender_id);
    const text = extractText(row);
    totalChars += text.length;
    const date = new Date(row.created_at);
    const h = date.getHours();
    hourly[h] = (hourly[h] || 0) + 1;
  }

  let mostActiveHour = 0;
  let maxCount = 0;
  for (let h = 0; h < 24; h++) {
    if (hourly[h] > maxCount) {
      maxCount = hourly[h];
      mostActiveHour = h;
    }
  }

  return {
    messageCount: rows.length,
    participantCount: participantIds.size,
    totalChars,
    hourlyDistribution: hourly,
    mostActiveHour,
  };
}

/**
 * 生成纯文本报告（不含 LLM 内容）
 */
export function formatTextReport(
  stats: BasicStats,
  options: { channelName?: string; days: number; startDate: string; endDate: string }
): string {
  const lines: string[] = [];
  const title = options.channelName
    ? `【${options.channelName}】群日常分析`
    : "群日常分析";
  lines.push(`📊 ${title}`);
  lines.push(`📅 统计区间：${options.startDate} 至 ${options.endDate}（最近 ${options.days} 天）`);
  lines.push("");
  lines.push(`💬 消息总数：${stats.messageCount} 条`);
  lines.push(`👥 参与人数：${stats.participantCount} 人`);
  lines.push(`📝 总字数：${stats.totalChars} 字`);
  lines.push(`⏰ 最活跃时段：${stats.mostActiveHour}:00 - ${stats.mostActiveHour + 1}:00`);
  lines.push("");
  lines.push("📈 每小时消息分布：");
  const maxH = Math.max(...Object.values(stats.hourlyDistribution), 1);
  for (let h = 0; h < 24; h++) {
    const c = stats.hourlyDistribution[h] || 0;
    const bar = "█".repeat(Math.round((c / maxH) * 10)) || "░";
    lines.push(`  ${String(h).padStart(2, "0")}:00 ${bar} ${c}`);
  }
  return lines.join("\n");
}

/**
 * 将 LLM 分析结果追加到文本报告。
 * 话题/金句/用户画像 设计灵感来自 astrbot_plugin_qq_group_daily_analysis
 */
export function appendLLMReport(textReport: string, llm: LLMAnalysis): string {
  const lines: string[] = [textReport, ""];
  if (llm.topics?.length) {
    lines.push("🔥 热门话题（LLM 提取）：");
    llm.topics.forEach((t, i) => {
      lines.push(`  ${i + 1}. ${t.topic}${t.summary ? ` — ${t.summary}` : ""}`);
    });
    lines.push("");
  }
  if (llm.quotes?.length) {
    lines.push("💬 金句（LLM 筛选）：");
    llm.quotes.forEach((q, i) => {
      lines.push(`  ${i + 1}. 「${q.content}」 — ${q.sender}（${q.reason}）`);
    });
    lines.push("");
  }
  if (llm.userTitles?.length) {
    lines.push("👤 用户画像/称号（LLM）：");
    llm.userTitles.forEach((u, i) => {
      lines.push(`  ${i + 1}. ${u.name} — ${u.title}${u.reason ? `（${u.reason}）` : ""}`);
    });
  }
  return lines.join("\n");
}

/**
 * 从 LLM 返回的文本中解析出 topics / quotes / userTitles。
 * 约定 LLM 返回 JSON 或类似结构，此处做宽松解析。
 */
export function parseLLMResponse(raw: string): LLMAnalysis {
  const result: LLMAnalysis = { topics: [], quotes: [], userTitles: [] };
  try {
    const trimmed = raw.trim();
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const obj = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      if (Array.isArray(obj.topics)) {
        result.topics = obj.topics.map((t: any) => ({
          topic: typeof t.topic === "string" ? t.topic : String(t.topic || ""),
          summary: typeof t.summary === "string" ? t.summary : undefined,
        }));
      }
      if (Array.isArray(obj.quotes)) {
        result.quotes = obj.quotes.map((q: any) => ({
          content: String(q.content ?? ""),
          sender: String(q.sender ?? ""),
          reason: String(q.reason ?? ""),
        }));
      }
      if (Array.isArray(obj.user_titles)) {
        result.userTitles = obj.user_titles.map((u: any) => ({
          name: String(u.name ?? ""),
          user_id: String(u.user_id ?? ""),
          title: String(u.title ?? ""),
          reason: typeof u.reason === "string" ? u.reason : undefined,
        }));
      }
    }
  } catch {
    // ignore parse errors
  }
  return result;
}
