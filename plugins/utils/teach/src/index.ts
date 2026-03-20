/**
 * @zhin.js/plugin-teach
 *
 * 自定义问答插件 —— 教会你的 Bot 自动应答
 *
 * 功能：
 *   - 教学问答对（精确匹配 / 正则匹配）
 *   - 上下文隔离（全局 / 群聊专属）
 *   - 中间件自动匹配回复
 *   - 数据库持久化
 *   - AI 工具集成（Agent 可查询和管理问答库）
 *
 * 命令：
 *   teach <问题> <回答>       添加问答对
 *   teach-regex <正则> <回答>  添加正则问答
 *   forget <问题>             删除问答对
 *   teach-list [页码]         查看问答列表
 *
 * 配置方式（zhin.config.yml）：
 * ```yaml
 * plugins:
 *   - "@zhin.js/plugin-teach"
 * teach:
 *   maxPerGroup: 200
 *   cooldown: 3000
 *   allowRegex: true
 *   pageSize: 10
 * ```
 */
import { usePlugin, ZhinTool, MessageCommand, Schema } from "zhin.js";

const plugin = usePlugin();
const { logger, root, addCommand, addMiddleware, useContext, onDispose, declareConfig } = plugin;

// ─── 配置 ─────────────────────────────────────────────────────────────────────

const config = declareConfig("teach", Schema.object({
  maxPerGroup: Schema.number().default(200).min(1).max(1000).description("每群最大问答数"),
  cooldown: Schema.number().default(3000).min(0).max(60000).description("同一问答触发冷却 (ms)"),
  allowRegex: Schema.boolean().default(true).description("是否允许正则问答"),
  pageSize: Schema.number().default(10).min(5).max(50).description("列表每页条数"),
}));

// ─── 冷却控制 ─────────────────────────────────────────────────────────────────

const cooldownMap = new Map<string, number>();

/**
 * 简单的 ReDoS 检查：拒绝可能导致灾难性回溯的正则
 * 检测嵌套量词、重复交替等常见危险模式
 */
function isSafeRegex(pattern: string): boolean {
  // 限制长度
  if (pattern.length > 200) return false;
  // 禁止嵌套量词: (a+)+ , (a*)* , (a+){2,} 等
  if (/(\+|\*|\{)\)?(\+|\*|\{)/.test(pattern)) return false;
  // 禁止回溯陷阱: (.+.+)+ , (a|a)+ 等
  if (/\([^)]*(\+|\*)[^)]*(\+|\*)[^)]*\)[\+\*]/.test(pattern)) return false;
  // 禁止过长的交替组: (a|b|c|d|e|f|g|h|...)+
  const altGroups = pattern.match(/\([^)]*\|[^)]*\)/g) || [];
  for (const g of altGroups) {
    if ((g.match(/\|/g) || []).length > 10) return false;
  }
  return true;
}

function isOnCooldown(key: string): boolean {
  const last = cooldownMap.get(key);
  if (!last) return false;
  return Date.now() - last < config.cooldown;
}

function markCooldown(key: string): void {
  cooldownMap.set(key, Date.now());
}

const cooldownCleanup = setInterval(() => {
  const now = Date.now();
  for (const [key, time] of cooldownMap) {
    if (now - time > config.cooldown * 2) cooldownMap.delete(key);
  }
}, 60_000);

onDispose(() => clearInterval(cooldownCleanup));

// ─── 辅助函数 ─────────────────────────────────────────────────────────────────

function getContextKey(message: any): { type: string; id: string } {
  if (message.type === "group") {
    return { type: "group", id: String(message.$group?.id || message.$target?.id || "") };
  }
  return { type: "global", id: "" };
}

function processAnswer(answer: string, message: any, match?: RegExpMatchArray): string {
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

function ts(): string {
  return new Date().toISOString();
}

// ─── 延迟数据库访问 ──────────────────────────────────────────────────────────
// database context 在 provide 时回调触发，但 models 在 start() 后才填充，
// 所以命令/中间件执行时按需获取 model。

let _db: any = null;

function getQA(): any {
  if (!_db) {
    const database = root.inject("database" as any) as any;
    if (database) _db = database;
  }
  return _db?.models?.get("teach_qa") ?? null;
}

// ─── 注册模型定义（在 database context 可用时） ──────────────────────────────

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
  logger.info("问答模型已注册，等待数据库启动");
});

// ─── 中间件：自动匹配问答 ────────────────────────────────────────────────────

async function findMatch(content: string, ctxType: string, ctxId: string): Promise<any | null> {
  const QA = getQA();
  if (!QA) return null;

  const allItems: any[] = await QA.select();
  const candidates = allItems.filter((item: any) => {
    if (item.context_type === "global") return true;
    return item.context_type === ctxType && item.context_id === ctxId;
  });

  for (const item of candidates) {
    if (!item.is_regex && item.question === content) return item;
  }

  if (config.allowRegex) {
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

addMiddleware(async function teachMatcher(message: any, next: () => Promise<void>) {
  const content = (message.$raw || "").trim();
  if (!content) return next();

  const { type: ctxType, id: ctxId } = getContextKey(message);
  const matched = await findMatch(content, ctxType, ctxId);
  if (!matched) return next();

  const cooldownKey = `${matched.id}:${ctxType}:${ctxId}`;
  if (isOnCooldown(cooldownKey)) return next();
  markCooldown(cooldownKey);

  const QA = getQA();
  if (QA) {
    try {
      await QA.update({ hit_count: (matched.hit_count || 0) + 1, updated_at: ts() }).where({ id: matched.id });
    } catch {}
  }

  let answer = matched.answer;
  if (matched.is_regex) {
    try {
      const m = content.match(new RegExp(matched.question, "i"));
      answer = processAnswer(answer, message, m || undefined);
    } catch {}
  } else {
    answer = processAnswer(answer, message);
  }

  await message.$reply(answer);
});

// ─── 命令：teach ─────────────────────────────────────────────────────────────

addCommand(
  new MessageCommand("teach <question:text> <answer:text>")
    .desc("教我问答", "教会 Bot 一个新的问答对")
    .usage("teach 你好 你好呀~")
    .examples("teach 你好 你好呀，{sender}！", "teach 晚安 晚安~好梦")
    .action(async (message: any, result: any) => {
      const QA = getQA();
      if (!QA) return "问答数据库尚未就绪，请稍后重试";

      const question = result.params.question?.trim();
      const answer = result.params.answer?.trim();
      if (!question || !answer) return "请提供问题和回答，格式：teach <问题> <回答>";

      const { type: ctxType, id: ctxId } = getContextKey(message);

      if (ctxType === "group") {
        const existing: any[] = await QA.select().where({ context_type: ctxType, context_id: ctxId });
        if (existing.length >= config.maxPerGroup) {
          return `该群问答数已达上限 (${config.maxPerGroup})，请先删除一些`;
        }
      }

      const duplicate: any[] = await QA.select().where({ question, context_type: ctxType, context_id: ctxId });
      if (duplicate.length > 0) {
        await QA.update({ answer, updated_at: ts() }).where({ id: duplicate[0].id });
        return `已更新问答：「${question}」→「${answer}」`;
      }

      await QA.insert({
        question, answer, is_regex: 0,
        context_type: ctxType, context_id: ctxId,
        creator_id: message.$sender?.id || "",
        creator_name: message.$sender?.name || "",
        hit_count: 0, created_at: ts(), updated_at: ts(),
      });

      return `学会了！发送「${question}」我会回复「${answer}」`;
    }),
);

// ─── 命令：teach-regex ───────────────────────────────────────────────────────

addCommand(
  new MessageCommand("teach-regex <pattern:text> <answer:text>")
    .desc("教我正则问答", "用正则表达式匹配，回答中可用 $1 $2 引用捕获组")
    .usage("teach-regex <正则> <回答>")
    .examples("teach-regex ^(早上好|早安)$ 早安，{sender}！")
    .action(async (message: any, result: any) => {
      const QA = getQA();
      if (!QA) return "问答数据库尚未就绪，请稍后重试";
      if (!config.allowRegex) return "管理员已禁用正则问答功能";

      const pattern = result.params.pattern?.trim();
      const answer = result.params.answer?.trim();
      if (!pattern || !answer) return "请提供正则和回答，格式：teach-regex <正则> <回答>";

      try {
        new RegExp(pattern, "i");
      } catch (e) {
        return `正则表达式不合法: ${(e as Error).message}`;
      }

      if (!isSafeRegex(pattern)) {
        return "该正则表达式可能导致性能问题（ReDoS 风险），请简化后重试";
      }

      const { type: ctxType, id: ctxId } = getContextKey(message);

      const dup: any[] = await QA.select().where({ question: pattern, is_regex: 1, context_type: ctxType, context_id: ctxId });
      if (dup.length > 0) {
        await QA.update({ answer, updated_at: ts() }).where({ id: dup[0].id });
        return `已更新正则问答：/${pattern}/ → 「${answer}」`;
      }

      await QA.insert({
        question: pattern, answer, is_regex: 1,
        context_type: ctxType, context_id: ctxId,
        creator_id: message.$sender?.id || "",
        creator_name: message.$sender?.name || "",
        hit_count: 0, created_at: ts(), updated_at: ts(),
      });

      return `学会了！匹配 /${pattern}/ 的消息我会回复「${answer}」`;
    }),
);

// ─── 命令：forget ────────────────────────────────────────────────────────────

addCommand(
  new MessageCommand("forget <question:text>")
    .desc("忘记问答", "删除一个已教的问答对")
    .usage("forget <问题>")
    .examples("forget 你好")
    .action(async (message: any, result: any) => {
      const QA = getQA();
      if (!QA) return "问答数据库尚未就绪，请稍后重试";

      const question = result.params.question?.trim();
      if (!question) return "请提供要删除的问题，格式：forget <问题>";

      const { type: ctxType, id: ctxId } = getContextKey(message);
      const items: any[] = await QA.select().where({ question, context_type: ctxType, context_id: ctxId });
      if (items.length === 0) {
        return `没有找到问题「${question}」的问答记录`;
      }

      await QA.delete().where({ id: items[0].id });
      return `已忘记「${question}」的回答`;
    }),
);

// ─── 命令：teach-list ────────────────────────────────────────────────────────

addCommand(
  new MessageCommand("teach-list [page:number]")
    .desc("问答列表", "查看当前上下文的所有问答对")
    .usage("teach-list [页码]")
    .examples("teach-list", "teach-list 2")
    .action(async (message: any, result: any) => {
      const QA = getQA();
      if (!QA) return "问答数据库尚未就绪，请稍后重试";

      const page = Math.max(1, result.params.page || 1);
      const { type: ctxType, id: ctxId } = getContextKey(message);

      const allItems: any[] = await QA.select().where(
        ctxType === "global"
          ? { context_type: "global" }
          : { context_type: ctxType, context_id: ctxId },
      );

      if (allItems.length === 0) return "还没有教过任何问答哦～";

      const totalPages = Math.ceil(allItems.length / config.pageSize);
      const safePage = Math.min(page, totalPages);
      const start = (safePage - 1) * config.pageSize;
      const pageItems = allItems.slice(start, start + config.pageSize);

      const lines = pageItems.map((item: any, i: number) => {
        const prefix = item.is_regex ? "[正则]" : "[精确]";
        const q = item.is_regex ? `/${item.question}/` : item.question;
        const hits = item.hit_count > 0 ? ` (${item.hit_count}次)` : "";
        return `${start + i + 1}. ${prefix} ${q} → ${item.answer}${hits}`;
      });

      const header = ctxType === "global" ? "全局问答列表" : "本群问答列表";
      const footer = `\n第 ${safePage}/${totalPages} 页 · 共 ${allItems.length} 条`;

      return `${header}\n${lines.join("\n")}${footer}`;
    }),
);

// ─── AI 工具 ─────────────────────────────────────────────────────────────────

plugin.addTool(
  new ZhinTool("teach_query")
    .desc("查询问答库中的问答对")
    .param("keyword", { type: "string", description: "搜索关键词（模糊匹配问题或回答）" })
    .execute(async (args: Record<string, any>) => {
      const QA = getQA();
      if (!QA) return "问答数据库尚未就绪";

      const keyword = args.keyword as string | undefined;
      const allItems: any[] = await QA.select();
      let items = allItems;
      if (keyword) {
        const kw = keyword.toLowerCase();
        items = allItems.filter(
          (item: any) => item.question.toLowerCase().includes(kw) || item.answer.toLowerCase().includes(kw),
        );
      }
      if (items.length === 0) return keyword ? `没有找到包含「${keyword}」的问答` : "问答库为空";

      return items
        .slice(0, 20)
        .map((item: any) => {
          const type = item.is_regex ? "[正则]" : "[精确]";
          const scope = item.context_type === "global" ? "全局" : `群${item.context_id}`;
          return `${type} ${item.question} → ${item.answer} (${scope}, ${item.hit_count}次命中)`;
        })
        .join("\n");
    })
    .toTool(),
);

plugin.addTool(
  new ZhinTool("teach_stats")
    .desc("查看问答库统计信息")
    .execute(async () => {
      const QA = getQA();
      if (!QA) return "问答数据库尚未就绪";

      const allItems: any[] = await QA.select();
      const globalCount = allItems.filter((i: any) => i.context_type === "global").length;
      const groupCount = allItems.filter((i: any) => i.context_type === "group").length;
      const regexCount = allItems.filter((i: any) => i.is_regex).length;
      const totalHits = allItems.reduce((sum: number, i: any) => sum + (i.hit_count || 0), 0);
      const topHits = [...allItems].sort((a: any, b: any) => (b.hit_count || 0) - (a.hit_count || 0)).slice(0, 5);

      let out = "问答库统计\n";
      out += `总数: ${allItems.length} 条 (全局 ${globalCount}, 群聊 ${groupCount})\n`;
      out += `正则问答: ${regexCount} 条\n`;
      out += `总命中: ${totalHits} 次\n`;

      if (topHits.length > 0) {
        out += `\n热门问答 TOP5:\n`;
        topHits.forEach((item: any, i: number) => {
          out += `${i + 1}. 「${item.question}」→「${item.answer}」(${item.hit_count}次)\n`;
        });
      }

      return out;
    })
    .toTool(),
);

logger.info(`插件已加载 (上限 ${config.maxPerGroup}/群, 冷却 ${config.cooldown}ms)`);
