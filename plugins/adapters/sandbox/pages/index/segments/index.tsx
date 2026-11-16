import React, { type ReactNode } from 'react';
import { MarkdownContent } from '@zhin.js/client';
import type { OutboundSegmentType } from '@zhin.js/core';
import { isJsxNode, segmentFallbackText } from '../segmentFallback.js';
import type { SandboxSegmentRenderContext, SandboxSegmentRenderer } from './context.js';
import { renderCode, renderDice, renderFace, renderMention, renderReply, renderRps, renderText } from './basic.js';
import { renderAudio, renderFile, renderImage, renderVideo } from './media.js';
import { renderCard, renderForward, renderLink, renderShare } from './cards.js';
import { renderHtml } from './html.js';
import { renderKeyboard, renderLegacyButton } from './keyboard.js';
import { renderQrcode } from './qrcode.js';
import { renderTts } from './tts.js';

export type { SandboxSegmentRenderContext, SandboxSegmentRenderer } from './context.js';

/**
 * ADR 0064 §2: a dedicated best-effect renderer for every type of Core's `OUTBOUND_SEGMENT_CATALOG`.
 * The `Record` key type makes a catalog type without a renderer a type error, and
 * `tests/sandbox-segment-renderers.test.ts` fails when the catalog grows without this map.
 */
export const SANDBOX_SEGMENT_RENDERERS: Readonly<Record<OutboundSegmentType, SandboxSegmentRenderer>> = Object.freeze({
  text: renderText,
  mention: renderMention,
  image: renderImage,
  audio: renderAudio,
  video: renderVideo,
  file: renderFile,
  reply: renderReply,
  forward: renderForward,
  face: renderFace,
  dice: renderDice,
  rps: renderRps,
  share: renderShare,
  card: renderCard,
  html: renderHtml,
  keyboard: renderKeyboard,
  link: renderLink,
  markdown: renderText,
  qrcode: renderQrcode,
  record: renderAudio,
  tts: renderTts,
  voice: renderAudio,
});

/** Aliases found in older history and hand-typed composer input; not outbound catalog types. */
const LEGACY_SEGMENT_RENDERERS: Readonly<Record<string, SandboxSegmentRenderer>> = Object.freeze({
  md: renderText,
  at: renderMention,
  code: renderCode,
  button: renderLegacyButton,
});

function rendererFor(type: string): SandboxSegmentRenderer | undefined {
  return Object.hasOwn(SANDBOX_SEGMENT_RENDERERS, type)
    ? SANDBOX_SEGMENT_RENDERERS[type as OutboundSegmentType]
    : Object.hasOwn(LEGACY_SEGMENT_RENDERERS, type) ? LEGACY_SEGMENT_RENDERERS[type] : undefined;
}

const warnedTypes = new Set<string>();

/** Development builds name each segment type that reached the fallback once (ADR 0064 §2). */
function warnFallback(type: string): void {
  const env = (import.meta as { env?: { DEV?: boolean } }).env;
  if (env?.DEV !== true || warnedTypes.has(type)) return;
  warnedTypes.add(type);
  console.warn(`[sandbox] no dedicated renderer for segment "${type}"; showing its fallback text (ADR 0064)`);
}

/**
 * Renders one segment. Only history data, unrendered JSX and third-party namespaced segments
 * (`foo:bar`) reach the fallback; every catalog type has its renderer.
 */
export function renderSandboxSegment(segment: unknown, context: SandboxSegmentRenderContext, key: string | number): ReactNode {
  const inverse = context.isSent ? 'zhin-markdown--inverse' : undefined;
  if (typeof segment === 'string') return <MarkdownContent key={key} text={segment} className={inverse} />;
  const record = segment && typeof segment === 'object' ? segment as { type?: unknown; data?: unknown } : {};
  const type = typeof record.type === 'string' ? record.type : '';
  const data = record.data && typeof record.data === 'object' && !Array.isArray(record.data)
    ? record.data as Readonly<Record<string, unknown>> : undefined;
  const renderer = !isJsxNode(segment) && data ? rendererFor(type) : undefined;
  if (renderer && data) return renderer(data, context, key);
  // Unrendered JSX (or a segment without data) is read as text with `[button]` labels, never as raw JSON.
  warnFallback(type || 'unknown');
  const fallback = segmentFallbackText(segment);
  return fallback
    ? <MarkdownContent key={key} text={fallback} className={inverse} />
    : <span key={key} className="sandbox-segment-note">[{type}]</span>;
}

/** Renders a message's segments in order. */
export function renderSandboxSegments(segments: readonly unknown[], context: SandboxSegmentRenderContext): ReactNode[] {
  return segments.map((segment, index) => renderSandboxSegment(segment, context, index));
}
