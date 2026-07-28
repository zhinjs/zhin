import type { CapabilityId } from '@zhin.js/plugin-runtime';
import type { CapabilityContext } from '@zhin.js/feature-kit';
import type { EndpointManagement } from './endpoint-management.js';

const adapterBrand = 'zhin.adapter/1' as const;

export type AdapterCapability = 'inbound' | 'outbound';

/** 端点可消费的出站媒体来源形式。 */
export type AdapterOutboundMedia = 'url' | 'path' | 'base64' | 'upload';

/** 交互段（卡片/按钮等富交互）的端点消费方式。 */
export type AdapterInteractiveMode = 'native' | 'text';

export interface EndpointSendRequest {
  readonly target: string;
  readonly payload: unknown;
  readonly parent?: { readonly type?: string; readonly id?: string; readonly name?: string };
}

export interface EndpointInstance<TResult = unknown> {
  /** Optional platform-neutral Console/Host management surface. */
  readonly management?: EndpointManagement;
  /** Allocates transport resources but must not admit inbound events yet. */
  start?(): void | Promise<void>;
  /** Opens admission after the candidate generation has committed. */
  open?(): void;
  /** Stops new inbound events while preserving in-flight work. */
  close?(): void | Promise<void>;
  /** Releases transport resources. Calls must be idempotent. */
  stop?(): void | Promise<void>;
  send?(request: EndpointSendRequest): TResult | Promise<TResult>;
}

export interface AdapterContext<TConfig = unknown> extends CapabilityContext<TConfig> {
  readonly id: CapabilityId;
  readonly name: string;
}

/**
 * html 段出站策略：
 * - `direct`：端点直接消费 html 段（Console UI 类端点），核心不做任何转换；
 * - `image`：经 html-renderer 渲染成 image 段，无渲染器时降级 text（缺省）；
 * - `text`：直接降级为 text 段。
 */
export type HtmlOutboundMode = 'direct' | 'image' | 'text';

/**
 * 端点消息段能力声明（出站协商降级的依据）。
 * 缺省（未声明 `segments`）保持历史行为：仅 html 段按 image/text 处理，
 * 其余段原样透传给端点。
 */
export interface AdapterSegmentPolicy {
  /**
   * 端点原生可消费的 wire 段类型（如 `['text', 'image', 'at']`）。
   * 声明后，未列出的段由核心按 `formatSegmentPreview` 降级为 text 段；
   * 不声明则不过滤（全部透传）。
   */
  readonly supported?: readonly string[];
  /** html 段处理策略，缺省 `image`。 */
  readonly html?: HtmlOutboundMode;
  /** 端点可消费的媒体来源形式；缺省表示不做媒体来源协商。 */
  readonly outboundMedia?: readonly AdapterOutboundMedia[];
  /**
   * 交互段（卡片/按钮等富交互）消费方式：`native` 原生渲染 / `text` 降级纯文本。
   * 目前仅为声明（供出站协商与门禁消费），`text` 的降级执行随 Wave 2 落地。
   */
  readonly interactive?: AdapterInteractiveMode;
}

const HTML_OUTBOUND_MODES: readonly HtmlOutboundMode[] = ['direct', 'image', 'text'];

const OUTBOUND_MEDIA_FORMS: readonly AdapterOutboundMedia[] = [
  'url', 'path', 'base64', 'upload',
];

export interface AdapterDefinition<TConfig = unknown, TResult = unknown> {
  readonly $feature: typeof adapterBrand;
  readonly capabilities: readonly AdapterCapability[];
  /** 可选：端点消息段能力声明（出站协商降级挂载点）。 */
  readonly segments?: AdapterSegmentPolicy;
  create(
    context: AdapterContext<TConfig>,
  ): EndpointInstance<TResult> | Promise<EndpointInstance<TResult>>;
}

export function defineAdapter<TConfig = unknown, TResult = unknown>(
  definition: Omit<AdapterDefinition<TConfig, TResult>, '$feature'>,
): Readonly<AdapterDefinition<TConfig, TResult>> {
  if (typeof definition.create !== 'function') {
    throw new TypeError('Adapter create must be a function');
  }
  const capabilities = [...new Set(definition.capabilities)];
  if (
    capabilities.length === 0
    || capabilities.some((value) => value !== 'inbound' && value !== 'outbound')
  ) {
    throw new TypeError('Adapter capabilities must contain inbound and/or outbound');
  }
  const segments = normalizeSegmentPolicy(definition.segments);
  return Object.freeze({
    ...definition,
    $feature: adapterBrand,
    capabilities: Object.freeze(capabilities),
    ...(segments ? { segments } : {}),
  });
}

function normalizeSegmentPolicy(
  policy: AdapterSegmentPolicy | undefined,
): AdapterSegmentPolicy | undefined {
  if (policy === undefined) return undefined;
  if (!policy || typeof policy !== 'object') {
    throw new TypeError('Adapter segments policy must be an object');
  }
  if (
    policy.supported !== undefined
    && (!Array.isArray(policy.supported)
      || policy.supported.some((type) => typeof type !== 'string' || !type))
  ) {
    throw new TypeError('Adapter segments.supported must be an array of segment type names');
  }
  if (policy.html !== undefined && !HTML_OUTBOUND_MODES.includes(policy.html)) {
    throw new TypeError('Adapter segments.html must be direct, image or text');
  }
  if (
    policy.outboundMedia !== undefined
    && (!Array.isArray(policy.outboundMedia)
      || policy.outboundMedia.length === 0
      || policy.outboundMedia.some(
        (form) => !OUTBOUND_MEDIA_FORMS.includes(form as AdapterOutboundMedia),
      ))
  ) {
    throw new TypeError(
      "Adapter segments.outboundMedia must be a non-empty array of 'url' | 'path' | 'base64' | 'upload'",
    );
  }
  if (
    policy.interactive !== undefined
    && policy.interactive !== 'native'
    && policy.interactive !== 'text'
  ) {
    throw new TypeError("Adapter segments.interactive must be 'native' or 'text'");
  }
  return Object.freeze({
    ...(policy.supported ? { supported: Object.freeze([...new Set(policy.supported)]) } : {}),
    ...(policy.html ? { html: policy.html } : {}),
    ...(policy.outboundMedia
      ? { outboundMedia: Object.freeze([...new Set(policy.outboundMedia)]) }
      : {}),
    ...(policy.interactive ? { interactive: policy.interactive } : {}),
  });
}

export function parseAdapterDefinition(value: unknown): AdapterDefinition {
  if (!value || typeof value !== 'object') throw invalidAdapter();
  const definition = value as Partial<AdapterDefinition>;
  if (
    definition.$feature !== adapterBrand
    || typeof definition.create !== 'function'
    || !Array.isArray(definition.capabilities)
    || definition.capabilities.length === 0
    || definition.capabilities.some(
      (capability) => capability !== 'inbound' && capability !== 'outbound',
    )
  ) throw invalidAdapter();
  // defineAdapter 已校验过形状；外部手工构造的 definition 也在此兜底
  normalizeSegmentPolicy(definition.segments);
  return definition as AdapterDefinition;
}

function invalidAdapter(): TypeError {
  return new TypeError('Adapter module must default-export defineAdapter(...)');
}
