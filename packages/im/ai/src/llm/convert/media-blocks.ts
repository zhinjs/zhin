/**
 * 媒体块序列化（provider 边界的唯一格式分岔点）。
 *
 * 内部媒体表达是 canonical MediaRef 同构块（MediaContentBlock）；
 * 各家 LLM API 格式只在这里映射。物化（下载/读盘）发生在 agent 的 media
 * pipeline——序列化器只消费 url / base64（含 data URI）两种已就绪形式，
 * 其余（path / 平台不透明 file 引用）明确拒绝为不可发送媒体。
 */
import {
  isMediaContentBlock,
  isMediaBlockRef,
  type MediaBlockRef,
  type MediaContentBlock,
} from '../types/content-block.js';

export type ProviderMediaKind = 'image' | 'audio' | 'video' | 'file';

/** Provider 未声明媒体能力时严格按纯文本处理，不猜测图片能力。 */
export const DEFAULT_PROVIDER_MEDIA: readonly ProviderMediaKind[] = Object.freeze([]);

const BASE64_PREFIX = 'base64://';
const DATA_URI_RE = /^data:([^;]+);base64,(.+)$/i;

export interface InlineMedia {
  /** 可直接内联的形式：远程 URL 或 data URI */
  readonly value: string;
  readonly mimeType: string;
  readonly isDataUri: boolean;
}

/**
 * MediaRef → 可内联数据（url 直挂 / base64 → data URI）。
 * path 与平台不透明 file 引用未物化，返回 undefined（调用方降级占位）。
 */
export function mediaRefToInline(ref: MediaBlockRef): InlineMedia | undefined {
  if (!isMediaBlockRef(ref)) return undefined;
  const mimeType = ref.mime_type ?? defaultMimeFor(ref);
  if (ref.kind === 'url') {
    if (!/^https?:\/\//i.test(ref.value) && !ref.value.startsWith('data:')) return undefined;
    return { value: ref.value, mimeType, isDataUri: ref.value.startsWith('data:') };
  }
  if (ref.kind === 'base64') {
    const raw = ref.value.startsWith(BASE64_PREFIX)
      ? ref.value.slice(BASE64_PREFIX.length)
      : ref.value;
    const dataUriMatch = DATA_URI_RE.exec(raw);
    if (dataUriMatch) {
      return { value: raw, mimeType: dataUriMatch[1] ?? mimeType, isDataUri: true };
    }
    return { value: `data:${mimeType};base64,${raw}`, mimeType, isDataUri: true };
  }
  return undefined;
}

function defaultMimeFor(ref: MediaBlockRef): string {
  return 'application/octet-stream';
}

/** 不支持/未物化媒体块的显式失败文本；不得伪装成成功识别的媒体占位。 */
export function mediaBlockPlaceholder(block: MediaContentBlock): string {
  const data = block?.data as { alt?: unknown; media?: unknown } | undefined;
  const alt = typeof data?.alt === 'string' && data.alt ? data.alt : undefined;
  const fileName = isMediaBlockRef(data?.media) && data.media.file_name
    ? data.media.file_name
    : undefined;
  const label = alt
    ?? fileName
    ?? ({ image: '图片', audio: '音频', video: '视频', file: '文件' } as const)[block.type]
    ?? '媒体';
  return `[Media unavailable: ${block.type}; ${label}]`;
}

export interface SerializedMedia {
  /** provider 可消费的媒体块（原样保留，由具体桥映射为 API 格式） */
  readonly accepted: MediaContentBlock[];
  /** 不支持 / 未物化的块的占位文本（按原顺序） */
  readonly placeholders: string[];
}

/**
 * 按 provider 媒体能力过滤媒体块：支持且已物化的进 accepted，
 * 其余折叠为占位文本（调用方拼进文本内容）。
 */
export function filterMediaBlocksForProvider(
  blocks: readonly MediaContentBlock[] | undefined,
  capabilities: readonly ProviderMediaKind[] = DEFAULT_PROVIDER_MEDIA,
): SerializedMedia {
  const accepted: MediaContentBlock[] = [];
  const placeholders: string[] = [];
  for (const block of blocks ?? []) {
    if (!capabilities.includes(block.type) || !isMediaContentBlock(block)) {
      placeholders.push(mediaBlockPlaceholder(block));
      continue;
    }
    if (!mediaRefToInline(block.data.media)) {
      placeholders.push(mediaBlockPlaceholder(block));
      continue;
    }
    accepted.push(block);
  }
  return { accepted, placeholders };
}
