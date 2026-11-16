import type { Segment } from './types.js';

/**
 * ADR 0064 §1: the single list of outbound segment types.
 *
 * Every type a plugin, a command or the Agent may hand to the outbound chain is listed here exactly
 * once, with the `messaging.segments.*` declaration that governs it and a minimal valid example.
 * The canonical guard (`assert.ts`), the IM delivery filter (`delivery.ts`), the Sandbox renderer
 * registry and the parity tests all read this list, so a new segment type cannot be added in one
 * place and silently forgotten in another (the Sandbox would otherwise drop it into its fallback).
 *
 * Contents = strict canonical types ∪ Core extension types − the inbound-only `action`.
 */

/**
 * The `messaging.segments.*` declaration that decides whether / how a segment type reaches the
 * platform (ADR 0044 §5 outbound):
 * - `markdown` / `html` / `interactive`: degraded by that policy when the adapter does not take it natively;
 * - `outboundMedia`: degraded to text when the media source form is not accepted;
 * - `supported`: passed through unchanged; only the optional `segments.supported` allow-list can reject it.
 */
export type OutboundSegmentCapability = 'supported' | 'markdown' | 'html' | 'outboundMedia' | 'interactive';

export interface OutboundSegmentCatalogEntry<Type extends string = string> {
  readonly type: Type;
  readonly capability: OutboundSegmentCapability;
  /**
   * The type the segment has after Core's canonical normalization. Equal to `type` except for
   * legacy aliases (`record` / `voice` are delivered as `audio`).
   */
  readonly canonicalType: string;
  /** A minimal valid segment of this type, for tests and renderer checks. */
  readonly example: Segment;
}

const media = (value: string, extra: Record<string, unknown> = {}) => ({ kind: 'url' as const, value, ...extra });

const entry = <Type extends string>(
  type: Type,
  capability: OutboundSegmentCapability,
  data: Record<string, unknown>,
  canonicalType: string = type,
): OutboundSegmentCatalogEntry<Type> => Object.freeze({
  type, capability, canonicalType,
  example: Object.freeze({ type, data: Object.freeze(data) }) as Segment,
});

/** ADR 0064 §1: every outbound segment type, in a stable order. */
export const OUTBOUND_SEGMENT_CATALOG = Object.freeze([
  // Strict canonical types (schema-validated).
  entry('text', 'supported', { text: 'Hello from Zhin' }),
  entry('mention', 'supported', { target: 'user-1', name: 'Alice' }),
  entry('image', 'outboundMedia', { media: media('https://example.com/cover.png'), alt: 'Cover' }),
  entry('audio', 'outboundMedia', { media: media('https://example.com/voice.mp3'), duration: 3 }),
  entry('video', 'outboundMedia', { media: media('https://example.com/clip.mp4'), alt: 'Clip' }),
  entry('file', 'outboundMedia', {
    media: media('https://example.com/report.pdf', { file_name: 'report.pdf', mime_type: 'application/pdf', size: 20480 }),
    name: 'report.pdf',
  }),
  entry('reply', 'supported', { message_id: 'message-1' }),
  entry('forward', 'supported', {
    forward_id: 'forward-1', title: 'Chat history',
    messages: [[{ type: 'text', data: { text: 'First message' } }]],
  }),
  entry('face', 'supported', { id: 14, name: 'smile' }),
  entry('dice', 'supported', { result: 4 }),
  entry('rps', 'supported', { result: 2 }),
  entry('share', 'supported', {
    url: 'https://example.com/song', title: 'Song title', description: 'Artist',
    image: 'https://example.com/song.jpg', audio: 'https://example.com/song.mp3',
  }),
  // Core extension types.
  entry('card', 'supported', { title: 'Card title', description: 'Card body' }),
  entry('html', 'html', { html: '<main style="padding:16px"><b>Card</b></main>' }),
  entry('keyboard', 'interactive', {
    rows: [[{ id: 'yes', label: 'Yes', payload: 'yes' }, { id: 'no', label: 'No', payload: 'no' }]],
  }),
  entry('link', 'supported', { url: 'https://example.com/docs', text: 'Docs' }),
  entry('markdown', 'markdown', { content: '**Bold** and [a link](https://example.com)' }),
  entry('qrcode', 'supported', { text: 'https://example.com/login' }),
  entry('record', 'outboundMedia', { media: media('https://example.com/record.mp3') }, 'audio'),
  entry('tts', 'supported', { text: 'Read this aloud' }),
  entry('voice', 'outboundMedia', { media: media('https://example.com/voice.ogg') }, 'audio'),
] as const);

/** ADR 0064 §1: an outbound segment type from {@link OUTBOUND_SEGMENT_CATALOG}. */
export type OutboundSegmentType = typeof OUTBOUND_SEGMENT_CATALOG[number]['type'];

/** ADR 0064 §1: the outbound segment types, in catalog order. */
export const OUTBOUND_SEGMENT_TYPES: readonly OutboundSegmentType[] = Object.freeze(
  OUTBOUND_SEGMENT_CATALOG.map((item) => item.type),
);

const outboundTypes: ReadonlySet<string> = new Set(OUTBOUND_SEGMENT_TYPES);

/** Whether `type` is listed in {@link OUTBOUND_SEGMENT_CATALOG}. */
export function isOutboundSegmentType(type: unknown): type is OutboundSegmentType {
  return typeof type === 'string' && outboundTypes.has(type);
}
