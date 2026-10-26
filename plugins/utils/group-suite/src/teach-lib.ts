import { messages as t } from './i18n.js';
import type { ConversationInput } from './conversation-scope.js';
import type { GroupSuiteConfig } from './config.js';
import { getTeachModel } from './db-store.js';
import {
  resolveContextKey,
  resolveSender,
  ts,
} from './shared-runtime.js';
import type { GroupSuiteRuntime } from './runtime-state.js';

export const TEACH_USAGE_HINT = '格式：关键词 回答，或 问题|答案';

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
  locale?: import('zhin.js/i18n').Locale,
): string {
  let result = answer;
  result = result.replace(/\{sender\}/g, sender.name || t(locale, 'you'));
  result = result.replace(/\{sender\.id\}/g, sender.id || '');
  result = result.replace(/\{time\}/g, new Date().toLocaleTimeString(locale ?? 'zh-CN'));
  result = result.replace(/\{date\}/g, new Date().toLocaleDateString(locale ?? 'zh-CN'));
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

type MessageInput = ConversationInput;

async function findMatch(
  content: string,
  ctxType: string,
  ctxId: string,
  cfg: GroupSuiteConfig,
  runtime: GroupSuiteRuntime,
): Promise<Record<string, unknown> | null> {
  const QA = getTeachModel(runtime.db);
  if (!QA) return null;
  const candidates = (await QA.select().where({
    context_type: ctxType, context_id: ctxId,
  })) as Record<string, unknown>[];
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
  runtime: GroupSuiteRuntime,
): Promise<string> {
  const QA = getTeachModel(runtime.db);
  if (!QA) return t(input.locale, 'teachRetry');
  if (regex && !cfg.teachAllowRegex) return t(input.locale, 'regexDisabled');

  const parsed = parseTeachPair(payload.trim());
  if (!parsed) {
    return regex
      ? t(input.locale, 'regexUsage')
      : t(input.locale, 'teachUsage');
  }
  const { question, answer } = parsed;

  if (regex) {
    try {
      new RegExp(question, 'i');
    } catch (e) {
      return t(input.locale, 'invalidRegex', { error: (e as Error).message });
    }
    if (!isSafeRegex(question)) return t(input.locale, 'unsafeRegex');
  }

  const { type: ctxType, id: ctxId } = resolveContextKey(input);
  const sender = resolveSender(input);

  if (ctxType === 'group') {
    const existing = (await QA.select().where({
      context_type: ctxType,
      context_id: ctxId,
    })) as Record<string, unknown>[];
    if (existing.length >= cfg.teachMaxPerGroup) {
      return t(input.locale, 'teachLimit', { limit: cfg.teachMaxPerGroup });
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
    return t(input.locale, 'teachUpdated', { question, answer });
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
    ? t(input.locale, 'regexLearned', { question, answer })
    : t(input.locale, 'teachLearned', { question, answer });
}

export async function teachList(
  input: MessageInput,
  cfg: GroupSuiteConfig,
  page = 1,
  runtime: GroupSuiteRuntime,
): Promise<string> {
  const QA = getTeachModel(runtime.db);
  if (!QA) return t(input.locale, 'teachDb');
  const safePage = Math.max(1, page);
  const { type: ctxType, id: ctxId } = resolveContextKey(input);
  const allItems = (await QA.select().where(
    { context_type: ctxType, context_id: ctxId },
  )) as Record<string, unknown>[];
  if (allItems.length === 0) return t(input.locale, 'teachEmpty');
  const totalPages = Math.ceil(allItems.length / cfg.teachPageSize);
  const pageNum = Math.min(safePage, totalPages);
  const start = (pageNum - 1) * cfg.teachPageSize;
  const pageItems = allItems.slice(start, start + cfg.teachPageSize);
  const lines = pageItems.map((item, i) => {
    const prefix = item.is_regex ? t(input.locale, 'regex') : t(input.locale, 'exact');
    const q = item.is_regex ? `/${item.question}/` : item.question;
    return `${start + i + 1}. ${prefix} ${q} → ${item.answer}`;
  });
  const header = t(input.locale, 'teachTitle');
  return t(input.locale, 'teachPage', { header, lines: lines.join('\n'), page: pageNum, pages: totalPages, count: allItems.length });
}

export async function teachForget(
  input: MessageInput,
  questionRaw: string,
  runtime: GroupSuiteRuntime,
): Promise<string> {
  const QA = getTeachModel(runtime.db);
  if (!QA) return t(input.locale, 'teachDb');
  const question = questionRaw.trim();
  if (!question) return t(input.locale, 'questionRequired');
  const { type: ctxType, id: ctxId } = resolveContextKey(input);
  const items = (await QA.select().where({
    question,
    context_type: ctxType,
    context_id: ctxId,
  })) as Record<string, unknown>[];
  if (items.length === 0) return t(input.locale, 'questionMissing', { question });
  await QA.delete().where(
    qaWhereKey(items[0] as {
      question: string;
      context_type: string;
      context_id: string;
      is_regex?: number | boolean;
    }),
  );
  return t(input.locale, 'questionRemoved', { question });
}

/** Try teach auto-reply; returns reply text or null. */
export async function tryTeachReply(
  input: MessageInput,
  cfg: GroupSuiteConfig,
  runtime: GroupSuiteRuntime,
): Promise<string | null> {
  const content = typeof input.content === 'string' ? input.content.trim() : '';
  if (!content) return null;
  const { type: ctxType, id: ctxId } = resolveContextKey(input);
  const matched = await findMatch(content, ctxType, ctxId, cfg, runtime);
  if (!matched) return null;

  const cooldownKey = JSON.stringify([matched.question, ctxType, ctxId, matched.is_regex ?? 0]);
  const cooldowns = runtime.teachCooldowns;
  const last = cooldowns.get(cooldownKey);
  if (last && Date.now() - last < cfg.teachCooldownMs) return null;
  cooldowns.set(cooldownKey, Date.now());

  const QA = getTeachModel(runtime.db);
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
      answer = processAnswer(answer, sender, m || undefined, input.locale);
    } catch {
      /* ignore */
    }
  } else {
    answer = processAnswer(answer, sender, undefined, input.locale);
  }
  return answer;
}
