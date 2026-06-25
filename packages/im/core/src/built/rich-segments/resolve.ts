import type { MessageElement, SendContent } from '../../types.js';
import { isRichSegment, richSegmentKind } from './base.js';
import { richSegmentRegistry } from './registry.js';
import type { OutboundRichSegmentPolicy, RichSegmentRenderContext } from './types.js';
import { RICH_SEGMENT_MODE } from './types.js';
import { CONTENT_CHAIN_STAGE } from '@zhin.js/logger';

function asArray(content: SendContent): (string | MessageElement)[] {
  return Array.isArray(content) ? content : [content];
}

function packSegments(out: (string | MessageElement)[]): SendContent {
  if (out.length === 0) return { type: 'text', data: { text: '' } };
  if (out.length === 1) return out[0]!;
  return out;
}

function appendRendered(
  out: (string | MessageElement)[],
  rendered: MessageElement | MessageElement[] | string,
): void {
  if (Array.isArray(rendered)) {
    out.push(...rendered);
    return;
  }
  out.push(rendered);
}

function primarySegmentType(
  rendered: MessageElement | MessageElement[] | string,
): string {
  if (typeof rendered === 'string') return 'text';
  if (Array.isArray(rendered)) {
    const first = rendered[0];
    if (typeof first === 'string') return 'text';
    const t = first?.type;
    return typeof t === 'string' ? t : 'unknown';
  }
  const t = rendered.type;
  return typeof t === 'string' ? t : 'unknown';
}

function detectRichSegmentFallback(mode: string, renderedType: string): boolean {
  if (mode === RICH_SEGMENT_MODE.IMAGE && renderedType !== 'image') return true;
  if (mode === RICH_SEGMENT_MODE.AUDIO && renderedType !== 'audio') return true;
  if (mode === RICH_SEGMENT_MODE.FILE && renderedType !== 'file') return true;
  return false;
}

export function hasRichSegment(content: SendContent | undefined): boolean {
  if (content == null) return false;
  return asArray(content).some((item) => {
    if (typeof item === 'string') return false;
    return richSegmentKind(item) != null || isRichSegment(item);
  });
}

/** 按 Adapter 出站策略在 renderSendMessage 首步统一渲染富媒体段 */
export async function resolveRichSegments(
  content: SendContent,
  policy: OutboundRichSegmentPolicy,
  ctx?: RichSegmentRenderContext,
): Promise<SendContent> {
  if (!hasRichSegment(content)) {
    return content;
  }

  const items = asArray(content);
  const out: (string | MessageElement)[] = [];

  for (const item of items) {
    if (typeof item === 'string') {
      out.push(item);
      continue;
    }

    const kind = isRichSegment(item) ? item.segmentType : richSegmentKind(item);
    if (!kind || !richSegmentRegistry.has(kind)) {
      out.push(item);
      continue;
    }

    const rich = isRichSegment(item)
      ? item
      : richSegmentRegistry.wrap(kind, item.data ?? {});
    const mode = richSegmentRegistry.resolveMode(policy, kind);
    const rendered = await rich.render(mode, ctx);
    const renderedType = primarySegmentType(rendered);
    const fallback = detectRichSegmentFallback(mode, renderedType);
    ctx?.logContentChain?.({
      stage: CONTENT_CHAIN_STAGE.RICH_SEGMENT,
      kind,
      mode,
      fallback,
      result: renderedType,
    });
    appendRendered(out, rendered);
  }

  return packSegments(out);
}
