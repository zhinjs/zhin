/**
 * 结构化 AI 出站解析 — JSON DSL + 协作 Cell 假 @ 兜底。
 */
import type { OutputElement } from '@zhin.js/ai';
import { renderToPlainText } from '@zhin.js/ai';
import type { Message, MessageElement } from '@zhin.js/core';
import {
  getHostRootPlugin,
  parseAiOutboundJson,
  extractEmbeddedAiOutboundJson,
  rewritePlainTextMentions,
  resolveAiOutboundToMessageElements,
  isStructuredOutboundRequired,
  detectInboundHandoffIntent,
  getAdapterAiOutboundCapabilities,
  getAdapterAiOutboundExtensions,
  type AiOutboundParseContext,
  type ZhinAiOutboundPayload,
} from '@zhin.js/core';
import { formatContentChainLog, CONTENT_CHAIN_STAGE } from '@zhin.js/logger';
import { resolvePeerEndpointInCell } from './collaboration-config.js';
import { resolveCollaborationCellForMessage } from './collaboration-context.js';
import { resolvePlatformAtId, type GroupMessageAdapterView } from './group-message.js';

function extractPlainTextFromElements(elements: OutputElement[]): string {
  const parts: string[] = [];
  for (const el of elements) {
    if (el.type === 'text') {
      if (el.content?.trim()) parts.push(el.content.trim());
    } else if (el.type === 'card') {
      const plain = renderToPlainText([el]).trim();
      if (plain) parts.push(plain);
    } else {
      return '';
    }
  }
  return parts.join('\n').trim();
}

function resolveAdapterView(message: Message): GroupMessageAdapterView | undefined {
  const plugin = getHostRootPlugin();
  if (!plugin) return undefined;
  return plugin.inject(message.$adapter) as GroupMessageAdapterView | undefined;
}

function buildParseContext(message: Message): AiOutboundParseContext | null {
  const cell = resolveCollaborationCellForMessage(message);
  const adapter = resolveAdapterView(message);
  if (!adapter) return null;

  const adapterInstance = getHostRootPlugin()?.inject(message.$adapter) as object | undefined;

  return {
    message,
    mentionResolver: cell
      ? (ref) => resolvePeerEndpointInCell(cell, ref)
      : undefined,
    atIdResolver: (endpointId) => resolvePlatformAtId(adapter, endpointId),
    extensions: adapterInstance ? getAdapterAiOutboundExtensions(adapterInstance) : [],
  };
}

async function payloadToSegments(
  payload: ZhinAiOutboundPayload,
  ctx: AiOutboundParseContext,
): Promise<MessageElement[] | null> {
  return resolveAiOutboundToMessageElements(payload, ctx);
}

export interface TryResolveStructuredAiOutboundOptions {
  inboundContent?: string;
  toolRequiresStructured?: boolean;
  warn?: (message: string) => void;
}

async function trySplitEmbeddedMentionBatches(
  message: Message,
  plain: string,
): Promise<MessageElement[][] | null> {
  const cell = resolveCollaborationCellForMessage(message);
  if (!cell) return null;

  const embedded = extractEmbeddedAiOutboundJson(plain);
  if (!embedded) return null;

  const ctx = buildParseContext(message);
  if (!ctx) return null;

  const payload = parseAiOutboundJson(embedded.jsonRaw);
  if (!payload?.mentions?.length) return null;

  const mentionSegments = await payloadToSegments(payload, ctx);
  if (!mentionSegments) return null;

  const batches: MessageElement[][] = [];
  if (embedded.prose.trim()) {
    batches.push([{ type: 'text', data: { text: ` ${embedded.prose.trim()}` } }]);
  }
  batches.push(mentionSegments);
  return batches;
}

/**
 * 解析 AI 结构化出站；若正文与 JSON 混排则拆成两条消息批次（先纯文本，后 @ 段）。
 */
export async function tryBuildCollaborationOutboundBatches(
  message: Message,
  elements: OutputElement[],
  options: TryResolveStructuredAiOutboundOptions = {},
): Promise<MessageElement[][] | null> {
  const plain = extractPlainTextFromElements(elements);
  if (plain) {
    const split = await trySplitEmbeddedMentionBatches(message, plain);
    if (split) return split;
  }

  const single = await tryResolveStructuredAiOutbound(message, elements, options);
  if (single) return [single];

  return null;
}

/**
 * 解析 AI 结构化出站（JSON 主路径 + 协作 Cell 假 @ 兜底）。
 * 非结构化场景或无法解析时返回 null。
 */
export async function tryResolveStructuredAiOutbound(
  message: Message,
  elements: OutputElement[],
  options: TryResolveStructuredAiOutboundOptions = {},
): Promise<MessageElement[] | null> {
  const cell = resolveCollaborationCellForMessage(message);
  const adapterInstance = getHostRootPlugin()?.inject(message.$adapter) as object | undefined;
  const extensions = adapterInstance ? getAdapterAiOutboundExtensions(adapterInstance) : [];
  const structuredRequired = isStructuredOutboundRequired({
    collaborationCell: Boolean(cell),
    toolRequiresStructured: options.toolRequiresStructured,
    inboundHandoffIntent: options.inboundContent
      ? detectInboundHandoffIntent(options.inboundContent)
      : false,
    adapterHasExtensions: extensions.length > 0,
  });

  if (!structuredRequired && !cell) return null;

  const plain = extractPlainTextFromElements(elements);
  if (!plain) return null;

  // 正文 + 嵌入 JSON 混排：交给 batch 拆分，避免 plain_mention_rewrite 吞掉 JSON 块。
  const embedded = extractEmbeddedAiOutboundJson(plain);
  if (embedded?.prose.trim()) return null;

  const ctx = buildParseContext(message);
  if (!ctx) return null;

  let payload = parseAiOutboundJson(plain);
  let fallback: string | undefined;

  if (!payload && cell && ctx.mentionResolver) {
    payload = rewritePlainTextMentions(plain, ctx.mentionResolver);
    if (payload) fallback = 'plain_mention_rewrite';
  }

  if (payload?.mentions?.length && cell) {
    const selfId = String(message.$endpoint ?? '');
    const filtered = payload.mentions.filter((ref) => {
      const resolved = ctx.mentionResolver?.(ref);
      return ref !== selfId && resolved !== selfId;
    });
    if (!filtered.length) {
      payload = payload.text?.trim() ? { ...payload, mentions: undefined } : null;
    } else if (filtered.length !== payload.mentions.length) {
      payload = { ...payload, mentions: filtered };
    }
  }

  if (!payload) {
    if (structuredRequired && options.warn) {
      options.warn(formatContentChainLog({
        stage: CONTENT_CHAIN_STAGE.OUTBOUND,
        kind: 'ai_outbound',
        fallback: 'plain_text',
        adapter: String(message.$adapter),
      }));
    }
    return null;
  }

  const segments = await payloadToSegments(payload, ctx);
  if (!segments) return null;

  if (fallback && options.warn) {
    options.warn(formatContentChainLog({
      stage: CONTENT_CHAIN_STAGE.OUTBOUND,
      kind: 'ai_outbound',
      fallback,
      adapter: String(message.$adapter),
    }));
  }

  return segments;
}

export function resolveStructuredOutboundRequired(
  message: Message | undefined,
  inboundContent?: string,
  toolRequiresStructured?: boolean,
): boolean {
  if (!message) return false;
  const cell = resolveCollaborationCellForMessage(message);
  const plugin = getHostRootPlugin();
  const adapterInstance = plugin?.inject(message.$adapter) as object | undefined;
  const extensions = adapterInstance ? getAdapterAiOutboundExtensions(adapterInstance) : [];
  const caps = adapterInstance ? getAdapterAiOutboundCapabilities(adapterInstance) : undefined;

  return isStructuredOutboundRequired({
    collaborationCell: Boolean(cell),
    toolRequiresStructured,
    inboundHandoffIntent: inboundContent ? detectInboundHandoffIntent(inboundContent) : false,
    adapterHasExtensions: (extensions.length > 0) || caps?.interactive === 'native',
  });
}
