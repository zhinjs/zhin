import type {
  CapabilityId,
  HtmlRendererHost,
  RuntimeSnapshot,
} from '@zhin.js/plugin-runtime';
import { htmlToFallbackText } from '../../built/html-to-text.js';
import { toCanonicalSegments } from '../../built/generic-segment-mapper.js';
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
 * - `base64`：平台接受 base64 直发（qq / icqq / slack / weixin-ilink）；
 * - `url-or-text`：平台仅接受 URL 媒体；本层无上传通道，base64/path → 文本降级；
 * - `passthrough`：adapter 自行物化媒体（napcat / onebot11 / onebot12），本层不动。
 */
export type OutboundMediaPolicy = 'base64' | 'url-or-text' | 'passthrough';

/**
 * 任务 C `defineAdapter` segments policy 挂载形状（duck-typed 读取）。
 * 契约形状为 `outboundMedia: readonly ('url'|'path'|'base64'|'upload')[]`
 * （端点可消费的媒体来源形式，见 `@zhin.js/adapter` 的 AdapterSegmentPolicy）；
 * 兼容过渡期的单值策略字符串。Adapter 在 definition 上声明
 * `segments: { outboundMedia }` 即覆盖内置表。
 */
export interface OutboundSegmentsPolicy {
  readonly outboundMedia?:
    | OutboundMediaPolicy
    | readonly ('url' | 'path' | 'base64' | 'upload')[];
}

export interface NormalizeOutboundOptions {
  /** 缺省 `base64`（保持历史行为：html→image base64 直发）。 */
  readonly mediaPolicy?: OutboundMediaPolicy;
}

const DEFAULT_CARD_WIDTH = 540;
const DEFAULT_CARD_FILENAME = 'card.png';
const DEFAULT_MEDIA_POLICY: OutboundMediaPolicy = 'base64';

/** 平台名 → 出站媒体策略（任务 C 声明式 policy 落地前的内置来源）。 */
const OUTBOUND_MEDIA_POLICY_BY_ADAPTER: Record<string, OutboundMediaPolicy> = {
  qq: 'base64',
  icqq: 'base64',
  slack: 'base64',
  'weixin-ilink': 'base64',
  telegram: 'url-or-text',
  line: 'url-or-text',
  lark: 'url-or-text',
  kook: 'url-or-text',
  dingtalk: 'url-or-text',
  'wechat-mp': 'url-or-text',
  wecom: 'url-or-text',
  email: 'url-or-text',
  github: 'url-or-text',
  milky: 'url-or-text',
  napcat: 'passthrough',
  onebot11: 'passthrough',
  onebot12: 'passthrough',
};

export function isOutboundSegment(value: unknown): value is OutboundSegment {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && typeof (value as { type?: unknown }).type === 'string';
}

/**
 * 解析端点的出站媒体策略：优先读 adapter definition 上声明的
 * `segments.outboundMedia`（任务 C 挂载点；多 endpoint 展开的 `slot~entry`
 * id 回退到 slot id 查声明），否则按平台名查内置表，
 * 未知平台回退 `base64`（历史行为）。
 */
export function resolveOutboundMediaPolicy(
  adapter: CapabilityId,
  snapshot: RuntimeSnapshot,
): OutboundMediaPolicy {
  const slot = snapshot.capabilities.get(adapter)
    ?? snapshot.capabilities.get(baseSlotCapabilityId(adapter));
  const declared = readDeclaredMediaPolicy(slot?.definition);
  if (declared) return declared;
  const packageName = slot ? snapshot.tree.get(slot.owner)?.packageName : undefined;
  const adapterType = adapterTypeName(packageName);
  return (adapterType ? OUTBOUND_MEDIA_POLICY_BY_ADAPTER[adapterType] : undefined)
    ?? DEFAULT_MEDIA_POLICY;
}

function readDeclaredMediaPolicy(definition: unknown): OutboundMediaPolicy | undefined {
  if (!definition || typeof definition !== 'object') return undefined;
  const segments = (definition as { segments?: unknown }).segments;
  if (!segments || typeof segments !== 'object') return undefined;
  const declared = (segments as OutboundSegmentsPolicy).outboundMedia;
  // 过渡期单值策略字符串
  if (declared === 'base64' || declared === 'url-or-text' || declared === 'passthrough') {
    return declared;
  }
  // 任务 C 契约：媒体来源形式数组 → 投递策略。
  // base64 可直发；无 base64 但端点可自行物化（upload/path）→ passthrough；
  // 仅 url → 非 URL 媒体文本降级。
  if (Array.isArray(declared)) {
    if (declared.includes('base64')) return 'base64';
    if (declared.includes('upload') || declared.includes('path')) return 'passthrough';
    if (declared.includes('url')) return 'url-or-text';
  }
  return undefined;
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
            // canonical MediaRef 为主，legacy `base64`/`name` 双写保持旧 adapter 可读
            // （Wave 2 适配器迁移完成后移除 legacy 字段）。
            media: { kind: 'base64', value: base64, mime_type: 'image/png' },
            base64,
            name: typeof data.fileName === 'string' ? data.fileName : DEFAULT_CARD_FILENAME,
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
 * 媒体协商：仅 `url-or-text` 需要在本层动作——image 段的非 URL MediaRef
 * （base64 / 本地路径）无法投递，降级为文本（alt 优先）。
 */
function applyOutboundMediaPolicy(
  segments: Segment[],
  mediaPolicy: OutboundMediaPolicy,
): Segment[] {
  if (mediaPolicy !== 'url-or-text') return segments;
  return segments.map((segment) => {
    if (segment.type !== 'image') return segment;
    const media = (segment.data as { media?: unknown }).media;
    if (!isMediaRef(media) || media.kind === 'url') return segment;
    const alt = typeof segment.data.alt === 'string' && segment.data.alt
      ? segment.data.alt
      : '[image]';
    return { type: 'text', data: { text: alt } };
  });
}

function htmlSegmentFallbackText(data: Record<string, unknown>, html: string): string {
  if (typeof data.text === 'string' && data.text.length > 0) return data.text;
  return html ? htmlToFallbackText(html) : '';
}
