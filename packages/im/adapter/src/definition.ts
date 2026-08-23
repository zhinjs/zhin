import type { CapabilityId } from '@zhin.js/plugin-runtime';
import type { CapabilityContext } from '@zhin.js/feature-kit';
import type {
  ConversationRef,
  EndpointCapabilities,
  EndpointOperation,
} from '@zhin.js/im-contract';
import type { EndpointManagement } from './endpoint-management.js';
import type { EndpointControl } from './endpoint-control.js';
import type { EndpointContentPort } from './endpoint-content.js';

const adapterBrand = 'zhin.adapter/1' as const;

export type AdapterCapability = 'inbound' | 'outbound';

/** Operations beyond sending, declared by an Adapter definition. */
export type AdapterOperation = Exclude<EndpointOperation, 'send'>;

/** Resolve operations for one concrete Endpoint configuration. */
export type AdapterOperationDeclaration<TConfig = unknown> =
  | readonly AdapterOperation[]
  | ((context: AdapterContext<TConfig>) => readonly AdapterOperation[]);

/** 端点可消费的出站媒体来源形式。 */
export type AdapterOutboundMedia = 'url' | 'path' | 'base64' | 'upload';

/** 交互段（卡片/按钮等富交互）的端点消费方式。 */
export type AdapterInteractiveMode = 'native' | 'text';
/** Markdown semantic segment consumption mode. */
export type AdapterMarkdownMode = 'native' | 'text';

export interface EndpointSendRequest {
  /** 结构化会话寻址；端点在平台边界自行派生原生 target。 */
  readonly conversation: ConversationRef;
  readonly payload: unknown;
}

export interface EndpointInstance {
  /** Optional platform-neutral Console/Host management surface. */
  readonly management?: EndpointManagement;
  /** Optional platform-neutral control surface for existing messages. */
  readonly control?: EndpointControl;
  /** Optional canonical resolver for message, merged-forward and media references. */
  readonly content?: EndpointContentPort;
  /** Required readiness; must observe abort and settle before rollback returns. */
  start?(signal: AbortSignal): void | Promise<void>;
  /** Opens Endpoint-local flow behind the candidate generation admission gate. */
  open?(): void;
  /** Stops new inbound events while preserving in-flight work. */
  close?(): void | Promise<void>;
  /** Releases transport resources. Calls must be idempotent. */
  stop?(): void | Promise<void>;
  /** Platform message id. Core wraps it in the canonical MessageRef/DeliveryReceipt. */
  send?(request: EndpointSendRequest): string | Promise<string>;
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
   * Core 在最终出站阶段执行统一降级。
   */
  readonly interactive?: AdapterInteractiveMode;
  /** `native` preserves Markdown for the endpoint codec; `text` strips formatting in Core. */
  readonly markdown?: AdapterMarkdownMode;
}

const HTML_OUTBOUND_MODES: readonly HtmlOutboundMode[] = ['direct', 'image', 'text'];

const OUTBOUND_MEDIA_FORMS: readonly AdapterOutboundMedia[] = [
  'url', 'path', 'base64', 'upload',
];

const ADAPTER_OPERATIONS: readonly AdapterOperation[] = ['recall', 'edit', 'reaction', 'typing'];

export interface AdapterDefinition<TConfig = unknown> {
  readonly $feature: typeof adapterBrand;
  readonly capabilities: readonly AdapterCapability[];
  /**
   * Explicit support for operations other than send. `send` is derived from
   * `capabilities: ['outbound']`; a method existing on an endpoint is not a
   * capability declaration.
   */
  readonly operations?: AdapterOperationDeclaration<TConfig>;
  /** 可选：端点消息段能力声明（出站协商降级挂载点）。 */
  readonly segments?: AdapterSegmentPolicy;
  create(
    context: AdapterContext<TConfig>,
  ): EndpointInstance | Promise<EndpointInstance>;
}

declare module '@zhin.js/plugin-runtime' {
  interface PluginSetupContext<TConfig = unknown> {
    addAdapter(
      localName: string,
      definition: AdapterDefinition<TConfig>,
    ): void;
  }
}

export function defineAdapter<TConfig = unknown>(
  definition: Omit<AdapterDefinition<TConfig>, '$feature'>,
): Readonly<AdapterDefinition<TConfig>> {
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
  const operations = typeof definition.operations === 'function'
    ? definition.operations
    : normalizeOperations(definition.operations);
  return Object.freeze({
    ...definition,
    $feature: adapterBrand,
    capabilities: Object.freeze(capabilities),
    ...(operations ? { operations } : {}),
    ...(segments ? { segments } : {}),
  });
}

/** Converts the definition's compact authoring form into the public contract. */
export function endpointCapabilitiesOf(
  definition: Pick<AdapterDefinition, 'capabilities' | 'operations'>,
  resolvedOperations?: readonly AdapterOperation[],
): EndpointCapabilities {
  if (typeof definition.operations === 'function' && resolvedOperations === undefined) {
    throw new TypeError('Dynamic Adapter operations must be resolved for one Endpoint');
  }
  const declared = resolvedOperations
    ?? (Array.isArray(definition.operations) ? definition.operations : undefined);
  const operations = declared?.reduce<Partial<Record<AdapterOperation, true>>>(
    (result, operation) => ({ ...result, [operation]: true }),
    {},
  );
  return Object.freeze({
    inbound: definition.capabilities.includes('inbound'),
    outbound: definition.capabilities.includes('outbound'),
    ...(operations && Object.keys(operations).length > 0 ? { operations: Object.freeze(operations) } : {}),
  });
}

/** Resolve and validate the operation declaration for one concrete Endpoint. */
export function resolveAdapterOperations<TConfig>(
  definition: Pick<AdapterDefinition<TConfig>, 'operations'>,
  context: AdapterContext<TConfig>,
): readonly AdapterOperation[] {
  const declaration = definition.operations;
  const operations = typeof declaration === 'function'
    ? declaration(context)
    : declaration;
  return normalizeOperations(operations) ?? Object.freeze([]);
}

function normalizeOperations(
  operations: readonly AdapterOperation[] | undefined,
): readonly AdapterOperation[] | undefined {
  if (operations === undefined) return undefined;
  if (
    !Array.isArray(operations)
    || operations.some((operation) => !ADAPTER_OPERATIONS.includes(operation))
  ) {
    throw new TypeError('Adapter operations must be recall, edit, reaction and/or typing');
  }
  return Object.freeze([...new Set(operations)]);
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
  if (
    policy.markdown !== undefined
    && policy.markdown !== 'native'
    && policy.markdown !== 'text'
  ) {
    throw new TypeError("Adapter segments.markdown must be 'native' or 'text'");
  }
  return Object.freeze({
    ...(policy.supported ? { supported: Object.freeze([...new Set(policy.supported)]) } : {}),
    ...(policy.html ? { html: policy.html } : {}),
    ...(policy.outboundMedia
      ? { outboundMedia: Object.freeze([...new Set(policy.outboundMedia)]) }
      : {}),
    ...(policy.interactive ? { interactive: policy.interactive } : {}),
    ...(policy.markdown ? { markdown: policy.markdown } : {}),
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
  if (typeof definition.operations !== 'function') {
    normalizeOperations(definition.operations);
  }
  return definition as AdapterDefinition;
}

function invalidAdapter(): TypeError {
  return new TypeError('Adapter module must default-export defineAdapter(...)');
}
