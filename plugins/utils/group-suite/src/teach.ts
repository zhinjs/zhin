import { MessageCommand, type Plugin } from "zhin.js";
import type { GroupSuiteConfig } from "./config.js";
import { extractInboundText, getMessageContextKey, ts } from "./shared.js";

const cooldownMap = new Map<string, number>();

function isSafeRegex(pattern: string): boolean {
  if (pattern.length > 200) return false;
  if (/(\+|\*|\{)\)?(\+|\*|\{)/.test(pattern)) return false;
  if (/\([^)]*(\+|\*)[^)]*(\+|\*)[^)]*\)[\+\*]/.test(pattern)) return false;
  const altGroups = pattern.match(/\([^)]*\|[^)]*\)/g) || [];
  for (const g of altGroups) {
    if ((g.match(/\|/g) || []).length > 10) return false;
  }
  return true;
}

/** 从 teach / teach-regex 命令的剩余文本解析「问题|答案」或「问题 答案」 */
function extractRestParam(payload: unknown): string {
  if (Array.isArray(payload)) {
    return payload.map((v) => String(v)).join(" ").trim();
  }
  return String(payload ?? "").trim();
}

function parseTeachPair(raw: string): { question: string; answer: string } | null {
  if (!raw) return null;
  const pipe = raw.indexOf("|");
  if (pipe >= 0) {
    const question = raw.slice(0, pipe).trim();
    const answer = raw.slice(pipe + 1).trim();
    if (question && answer) return { question, answer };
    return null;
  }
  const lastSpace = raw.lastIndexOf(" ");
  if (lastSpace < 0) return null;
  const question = raw.slice(0, lastSpace).trim();
  const answer = raw.slice(lastSpace + 1).trim();
  if (!question || !answer) return null;
  return { question, answer };
}

const TEACH_USAGE_HINT =
  "格式：teach 关键词 回答（回答可含空格），或 teach 问题|答案";

function processAnswer(
  answer: string,
  message: { $sender?: { name?: string; id?: string } },
  match?: RegExpMatchArray,
): string {
  let result = answer;
  result = result.replace(/\{sender\}/g, message.$sender?.name || "你");
  result = result.replace(/\{sender\.id\}/g, message.$sender?.id || "");
  result = result.replace(/\{time\}/g, new Date().toLocaleTimeString("zh-CN"));
  result = result.replace(/\{date\}/g, new Date().toLocaleDateString("zh-CN"));
  if (match) {
    for (let i = 1; i < match.length; i++) {
      result = result.replace(new RegExp(`\\$${i}`, "g"), match[i] || "");
    }
  }
  return result;
}

let _db: any = null;

function getQA(): any {
  return _db?.models?.get("teach_qa") ?? null;
}

/** teach_qa 无自增 id 列，更新/删除用业务主键 */
function qaWhereKey(row: {
  question: string;
  context_type: string;
  context_id: string;
  is_regex?: number | boolean;
}) {
  return {
    question: row.question,
    context_type: row.context_type,
    context_id: row.context_id,
    is_regex: row.is_regex ? 1 : 0,
  };
}

export function registerTeach(plugin: Plugin, cfg: GroupSuiteConfig): void {
  const { addCommand, useContext, onDispose } = plugin;
  const root = plugin.root;

  useContext("database", (db: any) => {
    _db = db;
    db.define("teach_qa", {
      question: { type: "text", nullable: false },
      answer: { type: "text", nullable: false },
      is_regex: { type: "integer", default: 0 },
      context_type: { type: "text", default: "global" },
      context_id: { type: "text", default: "" },
      creator_id: { type: "text", default: "" },
      creator_name: { type: "text", default: "" },
      hit_count: { type: "integer", default: 0 },
      created_at: { type: "text", default: "" },
      updated_at: { type: "text", default: "" },
    });
  });

  const cooldownCleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, time] of cooldownMap) {
      if (now - time > cfg.teachCooldownMs * 2) cooldownMap.delete(key);
    }
  }, 60_000);
  onDispose(() => clearInterval(cooldownCleanup));

  async function findMatch(
    content: string,
    ctxType: string,
    ctxId: string,
  ): Promise<any | null> {
    const QA = getQA();
    if (!QA) return null;
    const allItems: any[] = await QA.select();
    const candidates = allItems.filter(
      (item) =>
        item.context_type === "global" ||
        (item.context_type === ctxType && item.context_id === ctxId),
    );
    for (const item of candidates) {
      if (!item.is_regex && item.question === content) return item;
    }
    if (cfg.teachAllowRegex) {
      for (const item of candidates) {
        if (!item.is_regex) continue;
        try {
          if (new RegExp(item.question, "i").test(content)) return item;
        } catch {
          continue;
        }
      }
    }
    return null;
  }

  // 入站链只执行 root.middleware（见 packages/im/core inbound-runner）
  root.addMiddleware(async (message, next) => {
    const content = extractInboundText(message);
    if (!content) return next();
    const { type: ctxType, id: ctxId } = getMessageContextKey(message);
    const matched = await findMatch(content, ctxType, ctxId);
    if (!matched) return next();
    const cooldownKey = `${matched.question}:${ctxType}:${ctxId}:${matched.is_regex ?? 0}`;
    const last = cooldownMap.get(cooldownKey);
    if (last && Date.now() - last < cfg.teachCooldownMs) return next();
    cooldownMap.set(cooldownKey, Date.now());
    const QA = getQA();
    if (QA) {
      try {
        await QA.update({
          hit_count: (matched.hit_count || 0) + 1,
          updated_at: ts(),
        }).where(qaWhereKey(matched));
      } catch {
        /* ignore */
      }
    }
    let answer = matched.answer;
    if (matched.is_regex) {
      try {
        const m = content.match(new RegExp(matched.question, "i"));
        answer = processAnswer(answer, message, m || undefined);
      } catch {
        /* ignore */
      }
    } else {
      answer = processAnswer(answer, message);
    }
    await message.$reply(answer);
    return;
  });

  // 先注册较长前缀，避免 `teach [...]` 误匹配 teach-list / teach-regex
  addCommand(
    new MessageCommand("teach-list [page:number]")
      .desc("问答列表", "查看问答对")
      .action(async (message, result) => {
        const QA = getQA();
        if (!QA) return "问答数据库尚未就绪";
        const page = Math.max(1, result.params.page || 1);
        const { type: ctxType, id: ctxId } = getMessageContextKey(message);
        const allItems: any[] = await QA.select().where(
          ctxType === "global"
            ? { context_type: "global" }
            : { context_type: ctxType, context_id: ctxId },
        );
        if (allItems.length === 0) return "还没有教过任何问答哦～";
        const totalPages = Math.ceil(allItems.length / cfg.teachPageSize);
        const safePage = Math.min(page, totalPages);
        const start = (safePage - 1) * cfg.teachPageSize;
        const pageItems = allItems.slice(start, start + cfg.teachPageSize);
        const lines = pageItems.map((item, i) => {
          const prefix = item.is_regex ? "[正则]" : "[精确]";
          const q = item.is_regex ? `/${item.question}/` : item.question;
          return `${start + i + 1}. ${prefix} ${q} → ${item.answer}`;
        });
        const header = ctxType === "global" ? "全局问答列表" : "本群问答列表";
        return `${header}\n${lines.join("\n")}\n第 ${safePage}/${totalPages} 页 · 共 ${allItems.length} 条`;
      }),
  );

  addCommand(
    new MessageCommand("teach-regex [...payload:text]")
      .desc("教我正则问答", "用正则匹配")
      .usage("teach-regex 正则 回答", "teach-regex 正则|回答")
      .action(async (message, result) => {
        const QA = getQA();
        if (!QA) return "问答数据库尚未就绪";
        if (!cfg.teachAllowRegex) return "管理员已禁用正则问答";
        const parsed = parseTeachPair(extractRestParam(result.params.payload));
        if (!parsed) return "格式：teach-regex 正则 回答，或 teach-regex 正则|回答";
        const pattern = parsed.question;
        const answer = parsed.answer;
        try {
          new RegExp(pattern, "i");
        } catch (e) {
          return `正则表达式不合法: ${(e as Error).message}`;
        }
        if (!isSafeRegex(pattern)) return "该正则可能导致性能问题，请简化";
        const { type: ctxType, id: ctxId } = getMessageContextKey(message);
        await QA.insert({
          question: pattern,
          answer,
          is_regex: 1,
          context_type: ctxType,
          context_id: ctxId,
          creator_id: message.$sender?.id || "",
          creator_name: message.$sender?.name || "",
          hit_count: 0,
          created_at: ts(),
          updated_at: ts(),
        });
        return `学会了！匹配 /${pattern}/ 的消息我会回复「${answer}」`;
      }),
  );

  addCommand(
    new MessageCommand("forget <question:text>")
      .desc("忘记问答", "删除问答对")
      .action(async (message, result) => {
        const QA = getQA();
        if (!QA) return "问答数据库尚未就绪";
        const question = result.params.question?.trim();
        if (!question) return "请提供要删除的问题";
        const { type: ctxType, id: ctxId } = getMessageContextKey(message);
        const items: any[] = await QA.select().where({
          question,
          context_type: ctxType,
          context_id: ctxId,
        });
        if (items.length === 0) return `没有找到问题「${question}」`;
        await QA.delete().where(qaWhereKey(items[0]));
        return `已忘记「${question}」的回答`;
      }),
  );

  addCommand(
    new MessageCommand("teach [...payload:text]")
      .desc("教我问答", "教会 Bot 一个新的问答对")
      .usage("teach 关键词 回答", "teach 问题|答案")
      .action(async (message, result) => {
        const QA = getQA();
        if (!QA) return "问答数据库尚未就绪，请稍后重试";
        const parsed = parseTeachPair(extractRestParam(result.params.payload));
        if (!parsed) return TEACH_USAGE_HINT;
        const { question, answer } = parsed;
        const { type: ctxType, id: ctxId } = getMessageContextKey(message);
        if (ctxType === "group") {
          const existing: any[] = await QA.select().where({
            context_type: ctxType,
            context_id: ctxId,
          });
          if (existing.length >= cfg.teachMaxPerGroup) {
            return `该群问答数已达上限 (${cfg.teachMaxPerGroup})`;
          }
        }
        const duplicate: any[] = await QA.select().where({
          question,
          context_type: ctxType,
          context_id: ctxId,
        });
        if (duplicate.length > 0) {
          await QA.update({ answer, updated_at: ts() }).where(qaWhereKey(duplicate[0]));
          return `已更新问答：「${question}」→「${answer}」`;
        }
        await QA.insert({
          question,
          answer,
          is_regex: 0,
          context_type: ctxType,
          context_id: ctxId,
          creator_id: message.$sender?.id || "",
          creator_name: message.$sender?.name || "",
          hit_count: 0,
          created_at: ts(),
          updated_at: ts(),
        });
        return `学会了！发送「${question}」我会回复「${answer}」`;
      }),
  );
}
