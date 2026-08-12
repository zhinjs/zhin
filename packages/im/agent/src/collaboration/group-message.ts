/**
 * 群消息发送 — 经统一 Adapter.sendMessage 从当前 Endpoint 出站（ADR 0023 identity follows outbound）。
 */
import { type Message, type MessageElement } from '@zhin.js/core';
/** IM 单条文本上限（QQ 等约 4k；超长则分段连发，不截断省略）。 */
export const DEFAULT_IM_TEXT_CHUNK_CHARS = 4000;

export interface GroupMessageAdapterView {
  endpoints?: Map<string, { $config?: Record<string, unknown>; $platformUserId?: string }>;
  sendMessage?: (opts: {
    context: string;
    endpoint: string;
    id: string;
    type: string;
    parent?: { type: 'group' | 'guild'; id: string };
    content: unknown;
  }) => Promise<string>;
}

export function resolvePlatformAtId(
  adapter: GroupMessageAdapterView,
  endpointKey: string,
): string {
  const peer = adapter.endpoints?.get(endpointKey);
  return (
    (peer?.$platformUserId as string | undefined)
    ?? (peer?.$config?.name as string | undefined)
    ?? endpointKey
  );
}

/** 构建带一个或多个 platform @ segment 的消息内容。 */
export function buildAtMessageContent(
  adapter: GroupMessageAdapterView,
  atEndpointKeys: string[],
  text: string,
): MessageElement[] {
  const trimmed = text.trim();
  const segments: MessageElement[] = [];
  for (const endpointKey of atEndpointKeys) {
    const atId = resolvePlatformAtId(adapter, endpointKey);
    segments.push({ type: 'at', data: { id: atId, qq: atId } });
  }
  segments.push({ type: 'text', data: { text: trimmed.startsWith(' ') ? trimmed : ` ${trimmed}` } });
  return segments;
}

/** 将长文本按段落/换行/句读切分为多条 IM 可发长度，不省略内容。 */
export function splitLongTextForIm(
  text: string,
  maxChars = DEFAULT_IM_TEXT_CHUNK_CHARS,
): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  const chunks: string[] = [];
  let remaining = normalized;

  while (remaining.length > maxChars) {
    let splitAt = remaining.lastIndexOf('\n\n', maxChars);
    if (splitAt < maxChars * 0.5) {
      splitAt = remaining.lastIndexOf('\n', maxChars);
    }
    if (splitAt < maxChars * 0.5) {
      splitAt = Math.max(
        remaining.lastIndexOf('。', maxChars),
        remaining.lastIndexOf('！', maxChars),
        remaining.lastIndexOf('？', maxChars),
        remaining.lastIndexOf('. ', maxChars),
        remaining.lastIndexOf('! ', maxChars),
        remaining.lastIndexOf('? ', maxChars),
      );
    }
    if (splitAt < maxChars * 0.3) {
      splitAt = maxChars;
    } else {
      splitAt += 1;
    }
    const chunk = remaining.slice(0, splitAt).trim();
    if (chunk) chunks.push(chunk);
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function formatOutboundTextSegment(text: string): MessageElement {
  const trimmed = text.trim();
  return {
    type: 'text',
    data: { text: trimmed.startsWith(' ') ? trimmed : ` ${trimmed}` },
  };
}

/**
 * 出站 batch 中文本过长时拆成多条消息；@ 等非文本 segment 保留在首条。
 */
export function expandOutboundBatchesForLongText(
  batches: MessageElement[][],
  maxChars = DEFAULT_IM_TEXT_CHUNK_CHARS,
): MessageElement[][] {
  const expanded: MessageElement[][] = [];

  for (const batch of batches) {
    const nonText = batch.filter((seg) => seg.type !== 'text');
    const textParts = batch
      .filter((seg) => seg.type === 'text' && seg.data?.text != null)
      .map((seg) => String(seg.data!.text).trim())
      .filter(Boolean);
    const fullText = textParts.join('\n').trim();

    if (!fullText) {
      expanded.push(batch);
      continue;
    }
    if (fullText.length <= maxChars) {
      expanded.push(batch);
      continue;
    }

    if (nonText.length === 0) {
      for (const chunk of splitLongTextForIm(fullText, maxChars)) {
        expanded.push([formatOutboundTextSegment(chunk)]);
      }
      continue;
    }

    const chunks = splitLongTextForIm(fullText, maxChars);
    for (let i = 0; i < chunks.length; i++) {
      expanded.push([
        ...(i === 0 ? nonText : []),
        formatOutboundTextSegment(chunks[i]!),
      ]);
    }
  }

  return expanded.filter((batch) => batch.length > 0);
}

export interface SendGroupMessageContentInput {
  message: Message;
  content: unknown;
}

export async function sendGroupMessageContent(
  _input: SendGroupMessageContentInput,
): Promise<{ ok: boolean; error?: string }> {
  return { ok: false, error: 'Host plugin 未就绪' };
}

export interface SendGroupMessageInput {
  message: Message;
  text: string;
  /** 可选：在正文前 @ 目标 Endpoint（platform at segment） */
  atTargetEndpointKey?: string;
  /** 单条 IM 分段长度上限（默认 4000） */
  maxChars?: number;
}

export async function sendGroupMessageFromEndpoint(
  _input: SendGroupMessageInput,
): Promise<{ ok: boolean; error?: string }> {
  return { ok: false, error: 'Host plugin 未就绪' };
}
