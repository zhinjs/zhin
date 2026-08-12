import { parseQqBotKind, type QqBotKind } from './qq-intents.js';

/** 从命令/中间件入站消息提取会话键；无法识别时返回 undefined。 */
export function qqCommandSessionKey(input: unknown): string | undefined {
  const message = input as {
    conversation?: {
      endpoint?: { id?: unknown; adapter?: unknown };
      kind?: unknown;
      id?: unknown;
    };
    sender?: unknown;
  } | null | undefined;
  const conversation = message?.conversation;
  const adapter = conversation?.endpoint?.adapter;
  const endpointKey = conversation?.endpoint?.id;
  const kind = conversation?.kind;
  const id = conversation?.id;
  const sender = message?.sender;
  if (
    adapter == null
    || endpointKey == null
    || (kind !== 'private' && kind !== 'group' && kind !== 'channel')
    || typeof id !== 'string'
    || !id
    || sender == null
    || String(sender).trim() === ''
  ) {
    return undefined;
  }
  return `${String(adapter)}\0${String(endpointKey)}\0${kind}\0${id}\0${String(sender).trim()}`;
}

/**
 * 解析用户对公域/私域的回复。
 * 接受：public / private / 公域 / 私域（大小写不敏感，可带前后空白）。
 */
export function parseQqBotKindAnswer(raw: unknown): QqBotKind | undefined {
  const text = String(raw ?? '').trim().toLowerCase();
  if (!text) return undefined;
  if (text === '公域' || text === '公开' || text === '1') return 'public';
  if (text === '私域' || text === '2') return 'private';
  return parseQqBotKind(text);
}

export const QQ_BOT_KIND_PROMPT =
  '请回复 public（公域）或 private（私域），确认后一次性写入 .env 与配置。\n'
  + '也可发 qq.endpoint cancel 取消。';
