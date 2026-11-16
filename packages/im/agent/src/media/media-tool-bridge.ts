import type { AgentOutputElement } from '../outbound/agent-output.js';
import { isMediaBlockRef } from '@zhin.js/ai';
import type { Segment } from '@zhin.js/im-contract';
import type { ToolCallRecord } from '../core/tool-calls-user-format.js';

function parseToolResultObject(result: unknown): Record<string, unknown> | null {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    return result as Record<string, unknown>;
  }
  if (typeof result === 'string') {
    try {
      const parsed = JSON.parse(result) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}


/**
 * #1250 第 29 批：告诉模型「媒体已随回复发出」的固定说明。模型只看到元数据，不会看到也不必复述音频 / 图片内容。
 */
export const TOOL_MEDIA_SENT_NOTE = '语音已发送给用户（随本轮回复自动送达），不要在回复中重复输出音频内容、base64 或再发一段语音。';
export const TOOL_IMAGE_SENT_NOTE = '图片已发送给用户（随本轮回复自动送达），不要在回复中重复输出图片内容、base64 或再发一张图片。';

export { omitInlineBinaryForModel } from './inline-binary.js';

/** Model-safe tool output plus the media the host sends through the reply chain. */
export interface ToolResultMediaSplit {
  /** What the model may see: the original output with binary payloads replaced by metadata. */
  readonly output: unknown;
  /** Media produced by the tool, delivered with this turn's reply (Message.$reply → OutboundRenderer). */
  readonly media: readonly AgentOutputElement[];
}

/**
 * #1250 第 29 批 `voice-tts-base64-in-model-context`：媒体工具（`voice_tts`、无对象存储时的 `generate_image`）
 * 返回的 base64 在进入模型之前拆出来，交给出站链发送；模型只看到 `{ sent: true, format, size, … }` 这类元数据。
 * 其他工具、URL 形式的图片（`image_url`）原样返回。
 */
export function splitToolResultMedia(toolName: string, output: unknown): ToolResultMediaSplit {
  if (toolName !== 'voice_tts' && toolName !== 'generate_image') return { output, media: [] };
  const obj = parseToolResultObject(output);
  if (!obj) return { output, media: [] };
  if (toolName === 'voice_tts') {
    const { audio, message: _message, ...rest } = obj;
    if (typeof audio !== 'string' || !audio) return { output, media: [] };
    const format = typeof rest.format === 'string' ? rest.format : 'mp3';
    return {
      output: { ...rest, format, size: typeof rest.size === 'number' ? rest.size : base64Bytes(audio), sent: true, note: TOOL_MEDIA_SENT_NOTE },
      media: [audioElement(audio, format)],
    };
  }
  const { image, ...rest } = obj;
  if (typeof image !== 'string' || !image || (typeof rest.image_url === 'string' && rest.image_url)) return { output, media: [] };
  const mime = typeof rest.mime === 'string' ? rest.mime : 'image/png';
  return {
    output: { ...rest, mime, size: base64Bytes(image), sent: true, note: TOOL_IMAGE_SENT_NOTE },
    media: [imageElement(image, mime)],
  };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${(bytes / 1024).toFixed(1)}KB`;
}

/**
 * #1250 第 29 批：已发送的内嵌媒体在会话历史 / 日志里的占位（不含任何载荷）。
 * 例：`[语音 mp3 2.9KB 已发送]`、`[图片 image/png 3.1KB 已发送]`。
 */
export function sentInlineMediaPlaceholder(kind: string, format: string | undefined, bytes: number | undefined): string {
  const label = kind === 'audio' || kind === 'record' || kind === 'voice' ? '语音'
    : kind === 'image' ? '图片' : kind === 'video' ? '视频' : '文件';
  return `[${[label, format, bytes !== undefined ? formatSize(bytes) : undefined].filter(Boolean).join(' ')} 已发送]`;
}

function audioElement(audio: string, format: string): AgentOutputElement {
  const mime = format === 'wav' ? 'audio/wav' : format === 'ogg' || format === 'opus' ? 'audio/ogg' : 'audio/mpeg';
  // History and logs render `fallbackText`, never the data URL (#1250 第 29 批 review).
  return { type: 'audio', url: `data:${mime};base64,${audio}`, base64: audio,
    fallbackText: sentInlineMediaPlaceholder('audio', format, base64Bytes(audio)) };
}

function imageElement(image: string, mime: string): AgentOutputElement {
  // `alt` is also the platform's text fallback, so it names the image without claiming delivery.
  return { type: 'image', url: `data:${mime};base64,${image}`, base64: image,
    alt: `生成的图片（${mime} ${formatSize(base64Bytes(image))}）` };
}

function base64Bytes(value: string): number {
  const body = value.replace(/\s+/gu, '');
  return Math.max(0, Math.floor((body.length * 3) / 4) - (body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0));
}

/**
 * 从工具结果提取出站媒体（如 voice_tts → AudioElement）
 */
export function extractMediaElementsFromToolCalls(
  toolCalls: readonly ToolCallRecord[],
): AgentOutputElement[] {
  const out: AgentOutputElement[] = [];
  for (const tc of toolCalls) {
    if (tc.media?.length) out.push(...tc.media);
    const obj = parseToolResultObject(tc.result);
    if (!obj) continue;

    if (tc.tool === 'voice_tts') {
      const audio = obj.audio;
      if (typeof audio !== 'string' || !audio) continue;
      out.push(audioElement(audio, typeof obj.format === 'string' ? obj.format : 'mp3'));
      continue;
    }

    if (tc.tool === 'generate_image') {
      if (typeof obj.image_url === 'string' && obj.image_url) {
        out.push({ type: 'image', url: obj.image_url });
        continue;
      }
      const image = obj.image;
      if (typeof image !== 'string' || !image) continue;
      out.push(imageElement(image, typeof obj.mime === 'string' ? obj.mime : 'image/png'));
    }
  }
  return out;
}

export type ToolMediaKind = 'image' | 'audio' | 'video';

/** Media kinds the given tool calls produced (the kinds a copied inline payload is dropped for). */
export function toolMediaKinds(toolCalls: readonly ToolCallRecord[]): ReadonlySet<ToolMediaKind> {
  return new Set(extractMediaElementsFromToolCalls(toolCalls).flatMap(element =>
    element.type === 'audio' || element.type === 'image' || element.type === 'video' ? [element.type] : []));
}

export function segmentMediaKind(type: string): ToolMediaKind | undefined {
  if (type === 'image') return 'image';
  if (type === 'audio' || type === 'record' || type === 'voice') return 'audio';
  if (type === 'video') return 'video';
  return undefined;
}

/** A MediaRef that carries its bytes inline (`kind: base64`, a `data:` URL or `base64://`). */
export function isInlineMediaRef(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const media = value as { kind?: unknown; value?: unknown };
  if (media.kind === 'base64') return true;
  return typeof media.value === 'string' && /^(?:data:|base64:\/\/)/iu.test(media.value.trim());
}

/** A non-message output element whose bytes are inline. */
export function isInlineMediaElement(element: AgentOutputElement): boolean {
  if (element.type !== 'audio' && element.type !== 'image' && element.type !== 'video' && element.type !== 'file') return false;
  return ('base64' in element && !!element.base64) || /^(?:data:|base64:\/\/)/iu.test(element.url.trim());
}

/** Whether a reply segment is a copied inline payload of a kind this turn's tools already sent. */
export function isCopiedInlineSegment(segment: Segment, kinds: ReadonlySet<ToolMediaKind>): boolean {
  const kind = segmentMediaKind(segment.type);
  return !!kind && kinds.has(kind) && isInlineMediaRef((segment.data as { media?: unknown } | undefined)?.media);
}

/** What was dropped as a copy (for the turn trace `copied_inline_media_dropped`). */
export interface CopiedInlineMediaDrop {
  readonly kinds: readonly ToolMediaKind[];
  readonly count: number;
}

/**
 * #1250 第 29 批：本轮工具已产出某类媒体（如 voice_tts 的语音）时，模型回复里同类的内嵌媒体（base64 / data URL）
 * 只可能是抄写的副本（多半还是残缺的），不再当作第二段媒体发出。模型引用的 URL / 文件不受影响。
 */
function withoutCopiedInlineMedia(
  elements: AgentOutputElement[],
  kinds: ReadonlySet<ToolMediaKind>,
  onDropped?: (drop: CopiedInlineMediaDrop) => void,
): AgentOutputElement[] {
  if (!kinds.size) return elements;
  const out: AgentOutputElement[] = [];
  const dropped = new Set<ToolMediaKind>();
  let count = 0;
  for (const element of elements) {
    if (element.type === 'message') {
      const segments = element.segments.filter(segment => {
        if (!isCopiedInlineSegment(segment, kinds)) return true;
        dropped.add(segmentMediaKind(segment.type)!);
        count += 1;
        return false;
      });
      if (segments.length === element.segments.length) out.push(element);
      else if (segments.length) out.push({ ...element, segments });
      continue;
    }
    if ((element.type === 'audio' || element.type === 'image' || element.type === 'video') && kinds.has(element.type)
      && isInlineMediaElement(element)) {
      dropped.add(element.type);
      count += 1;
      continue;
    }
    out.push(element);
  }
  if (count) onDropped?.({ kinds: [...dropped], count });
  return out;
}

/** parseOutput 结果 + 工具媒体元素合并 */
export function mergeToolOutboundElements(
  elements: AgentOutputElement[],
  toolCalls: readonly ToolCallRecord[],
  onCopiedInlineMediaDropped?: (drop: CopiedInlineMediaDrop) => void,
): AgentOutputElement[] {
  const media = extractMediaElementsFromToolCalls(toolCalls);
  if (!media.length) return elements;
  elements = withoutCopiedInlineMedia(elements, new Set(media.flatMap(element =>
    element.type === 'audio' || element.type === 'image' || element.type === 'video' ? [element.type] : [])), onCopiedInlineMediaDropped);
  const imageUrls = new Set(elements.flatMap(element => element.type === 'image' ? [element.url]
    : element.type === 'message' ? element.segments.flatMap(segment =>
      segment.type === 'image' && isMediaBlockRef(segment.data.media) && segment.data.media.kind === 'url' ? [segment.data.media.value] : []) : []));
  return [...elements, ...media.filter(element => {
    if (element.type !== 'image' || element.base64) return true;
    if (imageUrls.has(element.url)) return false;
    imageUrls.add(element.url);
    return true;
  })];
}
