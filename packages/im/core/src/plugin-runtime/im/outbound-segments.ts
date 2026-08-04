import type {
  CapabilityId,
  HtmlRendererHost,
  RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import { htmlToFallbackText } from '../../built/html-to-text.js';
import { toCanonicalSegments } from '../../built/generic-segment-mapper.js';
import {
  effectiveKeyboardFallbackMap,
  renderKeyboardAsText,
} from '../../built/interactive-segments/resolve.js';
import {
  DEFAULT_INTERACTIVE_POLICY,
  isKeyboardSegment,
  type InteractivePolicy,
  type KeyboardSegmentData,
} from '../../built/interactive-segments/types.js';
import { isMediaRef, type Segment } from '../../built/segment-contract/index.js';

/**
 * Outbound payload normalization for the Plugin Runtime IM pipeline.
 *
 * `raw()` payloads reach adapters as-is; adapters only understand wire
 * segments (`{ type, data }` arrays). A single segment object (non-array)
 * would otherwise fall through to `String(payload)` → '[object Object]'.
 *
 * Segment payloads are normalized to the canonical Segment SSOT
 * (`built/segment-contract`，复用 `toCanonicalSegments`：at→mention、
 * 旧 wire 字段 `{url,file,base64}`→MediaRef)。`html` segments additionally
 * need a Host renderer: image when `@zhin.js/html-renderer` is installed,
 * plain-text fallback otherwise. 渲染产出的 base64 图片按端点声明的媒体
 * 能力（`resolveOutboundMediaPolicy`）协商降级。
 */

export interface OutboundSegment {
  readonly type: string;
  readonly data?: Record<string, unknown>;
}

/**
 * 出站媒体能力策略（html→image 渲染产物与 base64/path 媒体段的投递方式）：
 * - `base64`：平台接受 base64 直发；
 * - `url-or-text`：平台仅接受 URL 媒体；本层无上传通道，base64/path → 文本降级；
 * - `passthrough`：adapter 自行物化媒体，本层不动。
 */
export type OutboundMediaPolicy = 'base64' | 'url-or-text' | 'passthrough';

/**
 * adapter definition 的 segments policy 声明（必选能力面）。
 * `outboundMedia` 为端点可消费的媒体来源形式数组
 * （'url' | 'path' | 'base64' | 'upload'），映射到投递策略：
 * base64 可直发；无 base64 但端点可自行物化（upload/path）→ passthrough；
 * 仅 url → 非 URL 媒体文本降级。未声明的 adapter 按 ['url'] 兜底。
 */
export interface OutboundSegmentsPolicy {
  readonly outboundMedia: readonly ('url' | 'path' | 'base64' | 'upload')[];
  readonly interactive?: InteractivePolicy;
}

export interface NormalizeOutboundOptions {
  /** 缺省 `url-or-text`（未声明 adapter 的保守兜底：仅 URL 媒体可达）。 */
  readonly mediaPolicy?: OutboundMediaPolicy;
}

const DEFAULT_CARD_WIDTH = 540;
const DEFAULT_CARD_FILENAME = 'card.png';
const DEFAULT_MEDIA_POLICY: OutboundMediaPolicy = 'url-or-text';

/**
 * 解析端点的出站媒体策略：读 adapter definition 声明的 `segments.outboundMedia`
 * （多 endpoint 展开的 `slot~entry` id 回退到 slot id 查声明）；
 * 未声明回退 `url-or-text`（仅 URL 媒体可达，其余文本降级）。
 */
export function resolveOutboundMediaPolicy(
  adapter: CapabilityId,
  snapshot: RuntimeSnapshot,
): OutboundMediaPolicy {
  const slot = snapshot.capabilities.get(adapter)
    ?? snapshot.capabilities.get(baseSlotCapabilityId(adapter));
  return readDeclaredMediaPolicy(slot?.definition) ?? DEFAULT_MEDIA_POLICY;
}

function readDeclaredMediaPolicy(definition: unknown): OutboundMediaPolicy | undefined {
  if (!definition || typeof definition !== 'object') return undefined;
  const segments = (definition as { segments?: unknown }).segments;
  if (!segments || typeof segments !== 'object') return undefined;
  const declared = (segments as OutboundSegmentsPolicy).outboundMedia;
  if (!Array.isArray(declared)) return undefined;
  if (declared.includes('base64')) return 'base64';
  if (declared.includes('upload') || declared.includes('path')) return 'passthrough';
  if (declared.includes('url')) return 'url-or-text';
  return undefined;
}

export function isOutboundSegment(value: unknown): value is OutboundSegment {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && typeof (value as { type?: unknown }).type === 'string';
}

/**
 * 平台名 → 出站 interactive 策略（adapter 未声明 `segments.interactive` 时
 * 的内置来源）：telegram / discord 端点自行把 keyboard 编码为原生按钮；
 * 其余平台默认 'text'（编号文本降级，对齐旧轨 DEFAULT_INTERACTIVE_POLICY）。
 */
const OUTBOUND_INTERACTIVE_POLICY_BY_ADAPTER: Record<string, InteractivePolicy> = {
  telegram: 'native',
  discord: 'native',
};

/**
 * 解析端点的出站 interactive 策略：优先读 adapter definition 上声明的
 * `segments.interactive`，否则按平台名查内置表，未知平台回退 'text'。
 */
export function resolveOutboundInteractivePolicy(
  adapter: CapabilityId,
  snapshot: RuntimeSnapshot,
): InteractivePolicy {
  const slot = snapshot.capabilities.get(adapter)
    ?? snapshot.capabilities.get(baseSlotCapabilityId(adapter));
  const declared = readDeclaredInteractivePolicy(slot?.definition);
  if (declared) return declared;
  const packageName = slot ? snapshot.tree.get(slot.owner)?.packageName : undefined;
  const adapterType = adapterTypeName(packageName);
  return (adapterType ? OUTBOUND_INTERACTIVE_POLICY_BY_ADAPTER[adapterType] : undefined)
    ?? DEFAULT_INTERACTIVE_POLICY;
}

function readDeclaredInteractivePolicy(definition: unknown): InteractivePolicy | undefined {
  if (!definition || typeof definition !== 'object') return undefined;
  const segments = (definition as { segments?: unknown }).segments;
  if (!segments || typeof segments !== 'object') return undefined;
  const declared = (segments as OutboundSegmentsPolicy).interactive;
  return declared === 'native' || declared === 'text' ? declared : undefined;
}

/**
 * keyboard 段中央降级：'text' 端点把 keyboard 渲染为编号文本（复用旧轨
 * `renderKeyboardAsText`），并把有效 fallback 映射经 `remember` 回调写入
 * 中央存储（供入站数字回跳解析）；'native' 端点透传 keyboard。
 */
export function applyOutboundInteractivePolicy(
  payload: unknown,
  policy: InteractivePolicy,
  remember?: (map: Record<string, string>) => void,
): unknown {
  if (policy !== 'text' || !Array.isArray(payload)) return payload;
  return payload.map((item) => {
    if (!isKeyboardSegment(item)) return item;
    const data = item.data as KeyboardSegmentData;
    remember?.(effectiveKeyboardFallbackMap(data));
    return { type: 'text', data: { text: renderKeyboardAsText(data) } };
  });
}

/** 多 endpoint 展开的 record id（`slot.id~entry`）→ slot id（entry 名禁含 `~`，见 adapter-index）。 */
function baseSlotCapabilityId(adapter: CapabilityId): CapabilityId {
  const tilde = adapter.indexOf('~');
  return (tilde === -1 ? adapter : adapter.slice(0, tilde)) as CapabilityId;
}

/** `@zhin.js/adapter-icqq` → `icqq`；非 adapter 包名原样返回。 */
function adapterTypeName(packageName: string | undefined): string | undefined {
  if (!packageName) return undefined;
  return packageName.replace(/^@[^/]+\/adapter-/, '');
}

/**
 * Normalize a rendered outbound payload toward canonical wire segments:
 * - segment arrays stay arrays (html segments converted per element,
 *   其余段经 `toCanonicalSegments` 归一为 canonical Segment)；
 * - a single segment object is wrapped into a one-element array;
 * - anything else (plain strings, legacy `{ text }` shorthands) passes through.
 */
export async function normalizeOutboundPayload(
  payload: unknown,
  renderer?: HtmlRendererHost,
  options?: NormalizeOutboundOptions,
): Promise<unknown> {
  const mediaPolicy = options?.mediaPolicy ?? DEFAULT_MEDIA_POLICY;
  if (Array.isArray(payload)) {
    const resolved = await Promise.all(
      payload.map((item) => normalizeOneSegment(item, renderer, mediaPolicy)),
    );
    return applyOutboundMediaPolicy(resolved, mediaPolicy);
  }
  if (isOutboundSegment(payload)) {
    return applyOutboundMediaPolicy(
      [await normalizeOneSegment(payload, renderer, mediaPolicy)],
      mediaPolicy,
    );
  }
  return payload;
}

/**
 * 单个出站项 → canonical Segment：
 * - html 段走渲染/文本降级专线（产物已是 canonical 兼容形状，不再过
 *   `toCanonicalSegments`，以免 legacy 双写字段被 strip）；
 * - 其余项经 `toCanonicalSegments` 归一（字符串→text、at→mention、
 *   旧 wire 字段 `{url,file,base64}`→MediaRef）。
 */
async function normalizeOneSegment(
  item: unknown,
  renderer: HtmlRendererHost | undefined,
  mediaPolicy: OutboundMediaPolicy,
): Promise<Segment> {
  if (isOutboundSegment(item) && item.type === 'html') {
    return renderHtmlSegment(item, renderer, mediaPolicy);
  }
  return toCanonicalSegments([item])[0]!;
}

async function renderHtmlSegment(
  segment: OutboundSegment,
  renderer: HtmlRendererHost | undefined,
  mediaPolicy: OutboundMediaPolicy,
): Promise<Segment> {
  const data = segment.data ?? {};
  const html = typeof data.html === 'string' ? data.html : '';
  // url-or-text 端点无法投递 base64 图片（本层无上传通道），直接文本降级，跳过渲染。
  if (html && renderer && mediaPolicy !== 'url-or-text') {
    try {
      const result = await renderer.render(html, {
        width: typeof data.width === 'number' ? data.width : DEFAULT_CARD_WIDTH,
        format: 'png',
        ...(typeof data.backgroundColor === 'string'
          ? { backgroundColor: data.backgroundColor }
          : {}),
      });
      if (result.format === 'png' && result.data && typeof result.data === 'object') {
        const base64 = Buffer.from(result.data as Uint8Array).toString('base64');
        return {
          type: 'image',
          data: {
            media: {
              kind: 'base64',
              value: base64,
              mime_type: 'image/png',
              file_name: typeof data.fileName === 'string' ? data.fileName : DEFAULT_CARD_FILENAME,
            },
          },
        };
      }
    } catch {
      // 渲染失败 → 文本降级
    }
  }
  return { type: 'text', data: { text: htmlSegmentFallbackText(data, html) } };
}

/**
 * 媒体协商：仅 `url-or-text` 需要在本层动作——媒体段的非 URL MediaRef
 * （base64 / 本地路径）无法投递，降级为文本（alt / file_name 优先）。
 */
const MEDIA_SEGMENT_TYPES = new Set(['image', 'audio', 'video', 'file']);

function applyOutboundMediaPolicy(
  segments: Segment[],
  mediaPolicy: OutboundMediaPolicy,
): Segment[] {
  if (mediaPolicy !== 'url-or-text') return segments;
  return segments.map((segment) => {
    if (!MEDIA_SEGMENT_TYPES.has(segment.type)) return segment;
    const data = segment.data as { media?: unknown; alt?: unknown; name?: unknown };
    const media = data.media;
    if (!isMediaRef(media) || media.kind === 'url') return segment;
    const label = typeof data.alt === 'string' && data.alt
      ? data.alt
      : typeof data.name === 'string' && data.name
        ? data.name
        : media.file_name ?? `[${segment.type}]`;
    return { type: 'text', data: { text: label } };
  });
}

function htmlSegmentFallbackText(data: Record<string, unknown>, html: string): string {
  if (typeof data.text === 'string' && data.text.length > 0) return data.text;
  return html ? htmlToFallbackText(html) : '';
}
