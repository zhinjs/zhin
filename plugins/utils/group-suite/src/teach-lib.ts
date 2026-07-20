import type { GroupSuiteConfig } from './config.js';
import { getTeachModel } from './db-store.js';
import {
  resolveContextKey,
  resolveSender,
  ts,
} from './shared-runtime.js';

const cooldownMap = new Map<string, number>();

export const TEACH_USAGE_HINT =
  '格式：teach 关键词 回答（回答可含空格），或 teach 问题|答案';

function isSafeRegex(pattern: string): boolean {
  if (pattern.length > 200) return false;
  if (/(\+|\*|\{)\)?(\+|\*|\{)/.test(pattern)) return false;
  if (/\([^)]*(\+|\*)[^)]*(\+|\*)[^)]*\)[+*]/.test(pattern)) return false;
  const altGroups = pattern.match(/\([^)]*\|[^)]*\)/g) || [];
  for (const g of altGroups) {
    if ((g.match(/\|/g) || []).length > 10) return false;
  }
  return true;
}

export function parseTeachPair(raw: string): { question: string; answer: string } | null {
  if (!raw) return null;
  const pipe = raw.indexOf('|');
  if (pipe >= 0) {
    const question = raw.slice(0, pipe).trim();
    const answer = raw.slice(pipe + 1).trim();
    if (question && answer) return { question, answer };
    return null;
  }
  const lastSpace = raw.lastIndexOf(' ');
  if (lastSpace < 0) return null;
  const question = raw.slice(0, lastSpace).trim();
  const answer = raw.slice(lastSpace + 1).trim();
  if (!question || !answer) return null;
  return { question, answer };
}

function processAnswer(
  answer: string,
  sender: { id: string; name: string },
  match?: RegExpMatchArray,
): string {
  let result = answer;
  result = result.replace(/\{sender\}/g, sender.name || '你');
  result = result.replace(/\{sender\.id\}/g, sender.id || '');
  result = result.replace(/\{time\}/g, new Date().toLocaleTimeString('zh-CN'));
  result = result.replace(/\{date\}/g, new Date().toLocaleDateString('zh-CN'));
  if (match) {
    for (let i = 1; i < match.length; i++) {
      result = result.replace(new RegExp(`\\$${i}`, 'g'), match[i] || '');
    }
  }
  return result;
}

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

type MessageInput = {
  sender?: string;
  target?: string;
  content?: unknown;
  metadata?: Readonly<Record<string, unknown>>;
};

async function findMatch(
  content: string,
  ctxType: string,
  ctxId: string,
  cfg: GroupSuiteConfig,
): Promise<Record<string, unknown> | null> {
  const QA = getTeachModel();
  if (!QA) return null;
  const allItems = (await QA.select()) as Record<string, unknown>[];
  const candidates = allItems.filter(
    (item) =>
      item.context_type === 'global' ||
      (item.context_type === ctxType && item.context_id === ctxId),
  );
  for (const item of candidates) {
    if (!item.is_regex && item.question === content) return item;
  }
  if (cfg.teachAllowRegex) {
    for (const item of candidates) {
      if (!item.is_regex) continue;
      try {
        if (new RegExp(String(item.question), 'i').test(content)) return item;
      } catch {
        continue;
      }
    }
  }
  return null;
}

export async function teachAdd(
  input: MessageInput,
  cfg: GroupSuiteConfig,
  payload: string,
  regex = false,
): Promise<string> {
  const QA = getTeachModel();
  if (!QA) return '问答数据库尚未就绪，请稍后重试';
  if (regex && !cfg.teachAllowRegex) return '管理员已禁用正则问答';

  const parsed = parseTeachPair(payload.trim());
  if (!parsed) {
    return regex
      ? '格式：teach-regex 正则 回答，或 teach-regex 正则|回答'
      : TEACH_USAGE_HINT;
  }
  const { question, answer } = parsed;

  if (regex) {
    try {
      new RegExp(question, 'i');
    } catch (e) {
      return `正则表达式不合法: ${(e as Error).message}`;
    }
    if (!isSafeRegex(question)) return '该正则可能导致性能问题，请简化';
  }

  const { type: ctxType, id: ctxId } = resolveContextKey(input);
  const sender = resolveSender(input);

  if (ctxType === 'group') {
    const existing = (await QA.select().where({
      context_type: ctxType,
      context_id: ctxId,
    })) as Record<string, unknown>[];
    if (existing.length >= cfg.teachMaxPerGroup) {
      return `该群问答数已达上限 (${cfg.teachMaxPerGroup})`;
    }
  }

  const duplicate = (await QA.select().where({
    question,
    context_type: ctxType,
    context_id: ctxId,
  })) as Record<string, unknown>[];

  if (duplicate.length > 0 && !regex) {
    await QA.update({ answer, updated_at: ts() }).where(
      qaWhereKey(duplicate[0] as {
        question: string;
        context_type: string;
        context_id: string;
        is_regex?: number | boolean;
      }),
    );
    return `已更新问答：「${question}」→「${answer}」`;
  }

  await QA.insert({
    question,
    answer,
    is_regex: regex ? 1 : 0,
    context_type: ctxType,
    context_id: ctxId,
    creator_id: sender.id,
    creator_name: sender.name,
    hit_count: 0,
    created_at: ts(),
    updated_at: ts(),
  });

  return regex
    ? `学会了！匹配 /${question}/ 的消息我会回复「${answer}」`
    : `学会了！发送「${question}」我会回复「${answer}」`;
}

export async function teachList(
  input: MessageInput,
  cfg: GroupSuiteConfig,
  page = 1,
): Promise<string> {
  const QA = getTeachModel();
  if (!QA) return '问答数据库尚未就绪';
  const safePage = Math.max(1, page);
  const { type: ctxType, id: ctxId } = resolveContextKey(input);
  const allItems = (await QA.select().where(
    ctxType === 'global'
      ? { context_type: 'global' }
      : { context_type: ctxType, context_id: ctxId },
  )) as Record<string, unknown>[];
  if (allItems.length === 0) return '还没有教过任何问答哦～';
  const totalPages = Math.ceil(allItems.length / cfg.teachPageSize);
  const pageNum = Math.min(safePage, totalPages);
  const start = (pageNum - 1) * cfg.teachPageSize;
  const pageItems = allItems.slice(start, start + cfg.teachPageSize);
  const lines = pageItems.map((item, i) => {
    const prefix = item.is_regex ? '[正则]' : '[精确]';
    const q = item.is_regex ? `/${item.question}/` : item.question;
    return `${start + i + 1}. ${prefix} ${q} → ${item.answer}`;
  });
  const header = ctxType === 'global' ? '全局问答列表' : '本群问答列表';
  return `${header}\n${lines.join('\n')}\n第 ${pageNum}/${totalPages} 页 · 共 ${allItems.length} 条`;
}

export async function teachForget(input: MessageInput, questionRaw: string): Promise<string> {
  const QA = getTeachModel();
  if (!QA) return '问答数据库尚未就绪';
  const question = questionRaw.trim();
  if (!question) return '请提供要删除的问题';
  const { type: ctxType, id: ctxId } = resolveContextKey(input);
  const items = (await QA.select().where({
    question,
    context_type: ctxType,
    context_id: ctxId,
  })) as Record<string, unknown>[];
  if (items.length === 0) return `没有找到问题「${question}」`;
  await QA.delete().where(
    qaWhereKey(items[0] as {
      question: string;
      context_type: string;
      context_id: string;
      is_regex?: number | boolean;
    }),
  );
  return `已忘记「${question}」的回答`;
}

/** Try teach auto-reply; returns reply text or null. */
export async function tryTeachReply(
  input: MessageInput,
  cfg: GroupSuiteConfig,
): Promise<string | null> {
  const content = typeof input.content === 'string' ? input.content.trim() : '';
  if (!content) return null;
  const { type: ctxType, id: ctxId } = resolveContextKey(input);
  const matched = await findMatch(content, ctxType, ctxId, cfg);
  if (!matched) return null;

  const cooldownKey = `${matched.question}:${ctxType}:${ctxId}:${matched.is_regex ?? 0}`;
  const last = cooldownMap.get(cooldownKey);
  if (last && Date.now() - last < cfg.teachCooldownMs) return null;
  cooldownMap.set(cooldownKey, Date.now());

  const QA = getTeachModel();
  if (QA) {
    try {
      await QA.update({
        hit_count: Number(matched.hit_count || 0) + 1,
        updated_at: ts(),
      }).where(
        qaWhereKey(matched as {
          question: string;
          context_type: string;
          context_id: string;
          is_regex?: number | boolean;
        }),
      );
    } catch {
      /* ignore */
    }
  }

  const sender = resolveSender(input);
  let answer = String(matched.answer ?? '');
  if (matched.is_regex) {
    try {
      const m = content.match(new RegExp(String(matched.question), 'i'));
      answer = processAnswer(answer, sender, m || undefined);
    } catch {
      /* ignore */
    }
  } else {
    answer = processAnswer(answer, sender);
  }
  return answer;
}

/** Test helper */
export function resetTeachCooldown(): void {
  cooldownMap.clear();
}
