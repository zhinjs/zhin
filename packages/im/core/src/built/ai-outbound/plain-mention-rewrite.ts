import type { AiOutboundMentionResolver } from './types.js';
import type { ZhinAiOutboundPayload } from './types.js';

const PLAIN_MENTION_PATTERN = /@([\w-]+)/g;

/**
 * 从正文中提取 cell roster 可识别的假 @（@researcher / @210723495 等），
 * 剥离后返回等效 ZhinAiOutboundPayload。
 */
export function rewritePlainTextMentions(
  plainText: string,
  mentionResolver: AiOutboundMentionResolver,
): ZhinAiOutboundPayload | null {
  const trimmed = plainText.trim();
  if (!trimmed) return null;

  const mentions: string[] = [];
  let rewritten = trimmed;

  for (const match of trimmed.matchAll(PLAIN_MENTION_PATTERN)) {
    const token = match[1];
    if (!token) continue;
    const endpointId = mentionResolver(token);
    if (!endpointId) continue;
    const ref = token;
    if (!mentions.includes(ref)) mentions.push(ref);
  }

  if (mentions.length === 0) return null;

  rewritten = trimmed.replace(PLAIN_MENTION_PATTERN, (full, token: string) => {
    const endpointId = mentionResolver(token);
    return endpointId ? '' : full;
  });
  rewritten = rewritten
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+|\s+$/g, '')
    .trim();

  if (!rewritten) return null;

  return { mentions, text: rewritten };
}
