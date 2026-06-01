import type { Message } from '../message.js';
import type { Plugin } from '../plugin.js';
import type { QuotableBot, QuotedMessagePayload, RegisteredAdapter } from '../types.js';
import { segment } from '../utils.js';

const CACHE_TTL_MS = 180_000;
const cache = new Map<string, { at: number; payload: QuotedMessagePayload }>();

/** 与 agent `CURRENT_MESSAGE_MARKER` 文案一致，便于模型区分 context / 当前轮 */
export const QUOTED_MESSAGE_CONTEXT_MARKER =
  '[Quoted message context - the user is replying to this]';
export const CURRENT_USER_MESSAGE_MARKER = '[Current message - respond to this]';

/** 仅在本轮有引用 context 时由 agent 追加到 system，勿写入常驻 system 模板 */
export const QUOTE_CONTEXT_SYSTEM_HINT =
  'When the user asks "what is this", "what does this mean", or similar, interpret "this" as the quoted message in the user turn unless they clearly refer to something else (e.g. an @ mention).';

/** `ToolContext.extra` 键：值为 `QUOTE_CONTEXT_SYSTEM_HINT` 时表示本轮需注入引用说明 */
export const QUOTE_CONTEXT_SYSTEM_EXTRA_KEY = 'quoteContextSystemHint';

function cacheKey(adapter: string, bot: string, messageId: string): string {
  return `${adapter}:${bot}:${messageId}`;
}

function isQuotableBot(bot: unknown): bot is QuotableBot {
  return !!bot && typeof (bot as QuotableBot).$getMsg === 'function';
}

function quotedText(payload: QuotedMessagePayload): string {
  if (typeof payload.content === 'string') return payload.content;
  if (Array.isArray(payload.content) && payload.content.length) {
    return segment.raw(payload.content);
  }
  return payload.raw ?? '';
}

/** 格式化为 context 块（不含当前用户正文） */
export function formatQuoteContextBlock(
  payload: QuotedMessagePayload,
  failed?: boolean,
): string {
  const lines = [
    QUOTED_MESSAGE_CONTEXT_MARKER,
    `message_id: ${payload.messageId}`,
  ];
  if (payload.sender?.name || payload.sender?.id) {
    const who = payload.sender.name
      ? `${payload.sender.name} (${payload.sender.id ?? ''})`
      : String(payload.sender.id);
    lines.push(`sender: ${who.trim()}`);
  }
  if (failed) {
    lines.push('content: (could not fetch quoted message body)');
  } else {
    const text = quotedText(payload);
    if (text) lines.push(`content: ${text}`);
  }
  if (payload.time) lines.push(`time: ${payload.time}`);
  return lines.join('\n');
}

/**
 * 将引用 context 与当前用户消息分层拼成单条 user 文本（供 LLM / 多模态 text 部分）。
 */
export function buildUserTurnWithQuoteContext(
  userText: string,
  quoteContextBlock: string | null | undefined,
): string {
  if (!quoteContextBlock?.trim()) return userText;
  return `${quoteContextBlock.trim()}\n\n${CURRENT_USER_MESSAGE_MARKER}\n${userText}`;
}

/** 拉取被引用消息 payload（供 AI 多模态等复用） */
export async function resolveQuotedMessagePayload(
  message: Message<any>,
  root: Plugin,
  options?: { enabled?: boolean },
): Promise<QuotedMessagePayload | null> {
  if (options?.enabled === false || !message.$quote_id) return null;
  return fetchQuotedPayload(message, root);
}

async function fetchQuotedPayload(
  message: Message<any>,
  root: Plugin,
): Promise<QuotedMessagePayload | null> {
  const quoteId = message.$quote_id;
  if (!quoteId) return null;

  const adapterName = String(message.$adapter);
  const botId = String(message.$bot);
  const adapter = root.inject(adapterName as RegisteredAdapter) as
    | { bots?: Map<string, unknown> }
    | undefined;
  const bot = adapter?.bots?.get(botId);
  if (!isQuotableBot(bot)) return null;

  const key = cacheKey(adapterName, botId, quoteId);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.payload;

  try {
    const payload = await bot.$getMsg(quoteId);
    cache.set(key, { at: now, payload });
    return payload;
  } catch {
    return null;
  }
}

/** 拉取并格式化为引用 context 块；无引用或拉取失败时返回 null（失败时仍返回带说明的块） */
export async function resolveQuoteContextBlock(
  message: Message<any>,
  root: Plugin,
  options?: { enabled?: boolean },
): Promise<string | null> {
  if (options?.enabled === false || !message.$quote_id) {
    return null;
  }

  const payload = await fetchQuotedPayload(message, root);
  if (!payload) {
    return formatQuoteContextBlock(
      { messageId: message.$quote_id, content: '' },
      true,
    );
  }
  return formatQuoteContextBlock(payload);
}

/** 解析引用 context 并分层注入当前轮 user 内容 */
export async function prependQuoteContext(
  message: Message<any>,
  root: Plugin,
  userText: string,
  options?: { enabled?: boolean },
): Promise<string> {
  const quoteBlock = await resolveQuoteContextBlock(message, root, options);
  return buildUserTurnWithQuoteContext(userText, quoteBlock);
}
