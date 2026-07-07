import { segmentsForImDelivery } from '../segment-contract/delivery.js';
import type { Segment } from '../segment-contract/types.js';
import type { MessageElement } from '../../types.js';
import type { AiOutboundParseContext, ZhinAiOutboundPayload } from './types.js';

function buildMentionSegments(
  endpointIds: string[],
  text: string,
  ctx: AiOutboundParseContext,
): Segment[] {
  const segments: Segment[] = [];
  for (const endpointId of endpointIds) {
    const target = ctx.atIdResolver?.(endpointId) ?? endpointId;
    segments.push({ type: 'mention', data: { target } });
  }
  const body = text.trim();
  segments.push({
    type: 'text',
    data: { text: body.startsWith(' ') ? body : ` ${body}` },
  });
  return segments;
}

function resolveMentionEndpointIds(
  mentions: string[] | undefined,
  ctx: AiOutboundParseContext,
): { ok: true; endpointIds: string[] } | { ok: false; error: string } {
  if (!mentions?.length) {
    return { ok: false, error: 'mentions 不能为空' };
  }
  if (!ctx.mentionResolver) {
    return { ok: false, error: 'mentionResolver 未配置' };
  }
  const endpointIds: string[] = [];
  for (const ref of mentions) {
    const resolved = ctx.mentionResolver(ref);
    if (!resolved) {
      return { ok: false, error: `未知 peer "${ref}"` };
    }
    if (!endpointIds.includes(resolved)) endpointIds.push(resolved);
  }
  return { ok: true, endpointIds };
}

/** 将 ZhinAiOutboundPayload 转为 MessageElement[]（canonical segments + extensions）。 */
export async function resolveAiOutboundToMessageElements(
  payload: ZhinAiOutboundPayload,
  ctx: AiOutboundParseContext,
): Promise<MessageElement[] | null> {
  const segments: Segment[] = [];

  if (payload.mentions?.length) {
    const resolved = resolveMentionEndpointIds(payload.mentions, ctx);
    if (!resolved.ok) return null;
    const text = payload.text?.trim() ?? '';
    if (!text) return null;
    segments.push(...buildMentionSegments(resolved.endpointIds, text, ctx));
  } else if (payload.text?.trim()) {
    segments.push({ type: 'text', data: { text: payload.text.trim() } });
  }

  if (payload.segments?.length) {
    segments.push(...payload.segments);
  }

  const parts: MessageElement[] = segments.length
    ? segmentsForImDelivery(segments)
    : [];

  if (payload.extensions && ctx.extensions?.length) {
    for (const def of ctx.extensions) {
      const ext = payload.extensions[def.key];
      if (ext == null || !def.toMessageElements) continue;
      const extSegments = await def.toMessageElements(ext, ctx);
      parts.push(...(Array.isArray(extSegments) ? extSegments : [extSegments]));
    }
  }

  return parts.length ? parts : null;
}
