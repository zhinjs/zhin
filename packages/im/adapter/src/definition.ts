/**
 * Adapter authoring API consumed from `zhin.js/adapter`.
 * @module zhin.js/adapter
 */
import type { CapabilityId } from '@zhin.js/plugin-runtime';
import type { ConstructionContext } from '@zhin.js/feature-kit';
import type {
  EndpointCapabilities,
  EndpointOperation,
} from '@zhin.js/im-contract';
import type { Endpoint } from './endpoint.js';
import type { EndpointImplementation } from './endpoint-contract.js';
import {
  normalizeCapabilityProfile,
  type AdapterCapabilityProfile,
  type AdapterCapabilityResolver,
} from './capability-profile.js';

export { Endpoint } from './endpoint.js';
export type {
  EndpointActivationContext,
  EndpointCleanup,
  EndpointConnectionContext,
  EndpointConversation,
  EndpointEvent,
  EndpointEventSink,
  EndpointIdentity,
  EndpointImplementation,
  EndpointIncomingMessage,
  EndpointSendRequest,
  PlatformEvent,
} from './endpoint-contract.js';
export { defineEndpointClient } from './endpoint-client.js';
export type {
  EndpointClientContext,
  EndpointClientToken,
} from './endpoint-client.js';

const adapterBrand = 'zhin.adapter/1' as const;

/**
 * `liveDanmaku` (ADR 0038 §5): inbound messages are live-stream danmaku. The
 * Agent collects them in a window and answers one per window with read-only
 * tools only. Requires `inbound`.
 */
export type AdapterCapability = 'inbound' | 'outbound' | 'liveDanmaku';

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

/**
 * Generation-owned construction context for one runtime Endpoint.
 */
export interface AdapterContext<TConfig = unknown> extends ConstructionContext<TConfig> {
  readonly id: CapabilityId;
  /** Human-facing Endpoint id from `endpoints[].id`, or the Adapter local name. */
  readonly endpointId: string;
  /** Adapter module local name, stable across expanded Endpoint entries. */
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
   * 端点可消费的 canonical 段类型（如 `['text', 'image', 'mention']`）。
   * 声明后，核心完成既有 Markdown/HTML/媒体/交互策略后校验最终段；
   * 未列出的段使整条消息返回 unsupported，避免丢段后误报完整发送成功。
   * 不声明则不过滤（全部透传，由端点明确拒绝无法实现的段）。
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
  /**
   * Agent 最终回复的平台扩展（按段类型）：`fields` 为该段允许模型填写的可选字符串字段，
   * `hint` 追加到回复提示词。仅对实际提供给模型的段生效，不声明则不增加任何提示。
   */
  readonly model?: Readonly<Record<string, AdapterSegmentModelExtension>>;
  /**
   * Reactions the Agent may put on the message it answers instead of (or before) replying, like a
   * person who just taps 👍. Requires `control.addReaction` on the Endpoint.
   */
  readonly reaction?: AdapterReactionDeclaration;
}

export interface AdapterReactionDeclaration {
  /** Platform reaction values (emoji or platform ids) with what each means, shown to the model. */
  readonly values: readonly { readonly value: string; readonly label: string }[];
  /** Conversation kinds where reactions work; omitted means every kind. */
  readonly scopes?: readonly ('private' | 'group' | 'channel')[];
}

export interface AdapterSegmentModelExtension {
  readonly fields?: readonly string[];
  readonly hint?: string;
  /** Restrict model disclosure to these IM scenes; plain text remains a fallback without its scoped hints. */
  readonly scopes?: readonly ('private' | 'group' | 'channel')[];
}

const HTML_OUTBOUND_MODES: readonly HtmlOutboundMode[] = ['direct', 'image', 'text'];

const OUTBOUND_MEDIA_FORMS: readonly AdapterOutboundMedia[] = [
  'url', 'path', 'base64', 'upload',
];

const ADAPTER_OPERATIONS: readonly AdapterOperation[] = ['recall', 'edit', 'reaction', 'typing'];

export interface AdapterDefinition<TConfig = unknown, TClient = unknown> {
  /** @internal Runtime feature brand. */
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
  /**
   * ADR 0044: static capability profile per conversation kind (seven groups). `segments` is an alias of
   * `profile.default.messaging.segments` (declare it in one place), and `capabilities: ['liveDanmaku']`
   * is an alias of `profile.default.events.liveDanmaku`. Adapters without a profile get a conservative
   * one derived from `capabilities`, `operations` and `segments`.
   */
  readonly profile?: AdapterCapabilityProfile;
  /** ADR 0044: per-turn narrow-only refinement of the profile from trusted facts. */
  readonly resolveCapabilities?: AdapterCapabilityResolver;
  create(
    context: AdapterContext<TConfig>,
  ): Endpoint<TClient> | EndpointImplementation<TClient>
    | Promise<Endpoint<TClient> | EndpointImplementation<TClient>>;
}

declare module '@zhin.js/plugin-runtime' {
  interface PluginSetupContext<TConfig = unknown> {
    addAdapter(
      localName: string,
      definition: AdapterDefinition<TConfig>,
    ): void;
  }
}

/**
 * Define an Adapter module for the `adapters/` convention directory.
 *
 * The returned definition is immutable and declares capabilities before an
 * Endpoint is created, so Runtime admission can fail closed.
 *
 * @public
 * @example
 * ```ts
 * import { defineAdapter } from 'zhin.js/adapter';
 *
 * export default defineAdapter({
 *   capabilities: ['inbound', 'outbound'],
 *   create: () => ({
 *     client: myPlatformClient,
 *     connect: ({ events }) => myPlatformClient.onMessage((message) => events.message(message)),
 *     send: ({ conversation, payload }) => myPlatformClient.send(conversation.id, payload),
 *   }),
 * });
 * ```
 */
export function defineAdapter<TConfig = unknown, TClient = unknown>(
  definition: Omit<AdapterDefinition<TConfig, TClient>, '$feature'>,
): Readonly<AdapterDefinition<TConfig, TClient>> {
  if (typeof definition.create !== 'function') {
    throw new TypeError('Adapter create must be a function');
  }
  const capabilities = [...new Set(definition.capabilities)];
  if (
    capabilities.length === 0
    || capabilities.some((value) => value !== 'inbound' && value !== 'outbound' && value !== 'liveDanmaku')
    || !capabilities.some((value) => value === 'inbound' || value === 'outbound')
  ) {
    throw new TypeError('Adapter capabilities must contain inbound and/or outbound');
  }
  if (capabilities.includes('liveDanmaku') && !capabilities.includes('inbound')) {
    throw new TypeError('Adapter capability liveDanmaku requires inbound');
  }
  let segments = normalizeSegmentPolicy(definition.segments);
  if (definition.resolveCapabilities !== undefined && typeof definition.resolveCapabilities !== 'function') {
    throw new TypeError('Adapter resolveCapabilities must be a function');
  }
  let profile: AdapterCapabilityProfile | undefined;
  if (definition.profile !== undefined) {
    profile = normalizeCapabilityProfile(definition.profile, normalizeSegmentPolicy);
    const profileSegments = profile.default?.messaging?.segments;
    if (segments && profileSegments) {
      throw new TypeError(
        'Adapter declares segments twice: use segments or profile.default.messaging.segments, not both',
      );
    }
    // Existing consumers read `segments`; keep the alias populated from the profile.
    if (profileSegments) segments = profileSegments;
    const danmaku = profile.default?.events?.liveDanmaku === true;
    if (danmaku && !capabilities.includes('liveDanmaku')) capabilities.push('liveDanmaku');
    if (capabilities.includes('liveDanmaku') && !danmaku) {
      profile = normalizeCapabilityProfile({
        ...profile,
        default: { ...profile.default, events: { ...profile.default?.events, liveDanmaku: true } },
      }, normalizeSegmentPolicy);
    }
    if (capabilities.includes('liveDanmaku') && !capabilities.includes('inbound')) {
      throw new TypeError('Adapter capability liveDanmaku requires inbound');
    }
  }
  const operations = typeof definition.operations === 'function'
    ? definition.operations
    : normalizeOperations(definition.operations);
  return Object.freeze({
    ...definition,
    $feature: adapterBrand,
    capabilities: Object.freeze(capabilities),
    ...(operations ? { operations } : {}),
    ...(segments ? { segments } : {}),
    ...(profile ? { profile } : {}),
  });
}

/**
 * Converts the definition's compact authoring form into the Runtime contract.
 * @internal Adapter projection helper.
 */
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

/**
 * Resolve and validate the operation declaration for one concrete Endpoint.
 * @internal Adapter projection helper.
 */
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
  const model = normalizeSegmentModel(policy.model);
  const reaction = normalizeReaction(policy.reaction);
  return Object.freeze({
    ...(policy.supported ? { supported: Object.freeze([...new Set(policy.supported)]) } : {}),
    ...(policy.html ? { html: policy.html } : {}),
    ...(policy.outboundMedia
      ? { outboundMedia: Object.freeze([...new Set(policy.outboundMedia)]) }
      : {}),
    ...(policy.interactive ? { interactive: policy.interactive } : {}),
    ...(policy.markdown ? { markdown: policy.markdown } : {}),
    ...(model ? { model } : {}),
    ...(reaction ? { reaction } : {}),
  });
}

function normalizeReaction(reaction: AdapterSegmentPolicy['reaction']): AdapterSegmentPolicy['reaction'] {
  if (reaction === undefined) return undefined;
  const invalid = () => new TypeError('Adapter segments.reaction must be { values: { value, label }[], scopes?: (private | group | channel)[] }');
  if (!reaction || typeof reaction !== 'object' || !Array.isArray(reaction.values) || reaction.values.length === 0) throw invalid();
  if (reaction.values.some(item => !item || typeof item.value !== 'string' || !item.value || typeof item.label !== 'string' || !item.label.trim())) throw invalid();
  if (reaction.scopes !== undefined && (!Array.isArray(reaction.scopes) || reaction.scopes.some(scope => scope !== 'private' && scope !== 'group' && scope !== 'channel'))) throw invalid();
  const values = [...new Map(reaction.values.map(item => [item.value, Object.freeze({ value: item.value, label: item.label.trim() })])).values()];
  return Object.freeze({
    values: Object.freeze(values),
    ...(reaction.scopes ? { scopes: Object.freeze([...new Set(reaction.scopes)]) } : {}),
  });
}

function normalizeSegmentModel(
  model: AdapterSegmentPolicy['model'],
): AdapterSegmentPolicy['model'] {
  if (model === undefined) return undefined;
  const invalid = () => new TypeError('Adapter segments.model must map segment types to { fields?: string[], hint?: string, scopes?: (private | group | channel)[] }');
  if (!model || typeof model !== 'object' || Array.isArray(model)) throw invalid();
  return Object.freeze(Object.fromEntries(Object.entries(model).map(([type, extension]) => {
    if (!extension || typeof extension !== 'object') throw invalid();
    const { fields, hint, scopes } = extension;
    if (fields !== undefined && (!Array.isArray(fields) || fields.some(field => typeof field !== 'string' || !field))) throw invalid();
    if (hint !== undefined && (typeof hint !== 'string' || !hint.trim())) throw invalid();
    if (scopes !== undefined && (!Array.isArray(scopes) || scopes.length === 0
      || scopes.some(scope => scope !== 'private' && scope !== 'group' && scope !== 'channel'))) throw invalid();
    return [type, Object.freeze({
      ...(fields ? { fields: Object.freeze([...new Set(fields)]) } : {}),
      ...(hint ? { hint: hint.trim() } : {}),
      ...(scopes ? { scopes: Object.freeze([...new Set(scopes)]) } : {}),
    })];
  })));
}

/** @internal Runtime validation for convention-discovered modules. */
export function parseAdapterDefinition(value: unknown): AdapterDefinition {
  if (!value || typeof value !== 'object') throw invalidAdapter();
  const definition = value as Partial<AdapterDefinition>;
  if (
    definition.$feature !== adapterBrand
    || typeof definition.create !== 'function'
    || !Array.isArray(definition.capabilities)
    || definition.capabilities.length === 0
    || definition.capabilities.some(
      (capability) => capability !== 'inbound' && capability !== 'outbound' && capability !== 'liveDanmaku',
    )
    || (definition.capabilities.includes('liveDanmaku') && !definition.capabilities.includes('inbound'))
  ) throw invalidAdapter();
  // defineAdapter 已校验过形状；外部手工构造的 definition 也在此兜底
  normalizeSegmentPolicy(definition.segments);
  if (definition.profile !== undefined) {
    normalizeCapabilityProfile(definition.profile, normalizeSegmentPolicy);
  }
  if (definition.resolveCapabilities !== undefined && typeof definition.resolveCapabilities !== 'function') {
    throw invalidAdapter();
  }
  if (typeof definition.operations !== 'function') {
    normalizeOperations(definition.operations);
  }
  return definition as AdapterDefinition;
}

function invalidAdapter(): TypeError {
  return new TypeError('Adapter module must default-export defineAdapter(...)');
}
