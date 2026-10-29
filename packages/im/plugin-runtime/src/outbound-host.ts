import { createRootPrivateToken, createToken } from './token.js';
import type { DeliveryTarget } from './delivery-target.js';
import type { PluginId } from './identity.js';
import type { Locale } from './i18n.js';
import { generationAdmissionBinder, generationAdmissionSource, type GenerationAdmissionGate } from './admission.js';
import { OwnerOperation } from './owner-operation.js';

/**
 * 未锚定 endpoint 的会话地址（结构对齐 `@zhin.js/im-contract` 的
 * `Omit<ConversationRef, 'endpoint'>`；plugin-runtime 是零依赖 kernel 层，
 * 不能 import IM 契约，故此处独立声明，靠结构类型兼容）。
 */
export interface OutboundConversation {
  readonly kind: 'private' | 'group' | 'channel';
  readonly id: string;
  readonly parent?: Readonly<{
    readonly kind: 'private' | 'group' | 'channel';
    readonly id: string;
  }>;
  readonly threadId?: string;
}

/**
 * Thin Host Resource for proactive Adapter outbound (RSS poll, lottery push,
 * activity-feedback typing text). Implementations typically wrap ImRuntime
 * `sendEndpointMessage` (resolve adapter/endpoint → AdapterIndex.send).
 */
export interface OutboundSendInput {
  /** Language captured by the originating operation or persisted task. */
  readonly locale?: Locale;
  readonly adapter: string;
  readonly endpointKey: string;
  readonly conversation: OutboundConversation;
  readonly content: string;
}

export interface OutboundReactionInput {
  readonly adapter: string;
  readonly endpointKey: string;
  readonly message: OutboundMessage;
  readonly emoji: string;
  readonly sceneType?: string;
  readonly channelId?: string;
}

export interface OutboundRemoveReactionInput {
  readonly adapter: string;
  readonly endpointKey: string;
  readonly message: OutboundMessage;
  readonly reactionId: string;
}

export interface OutboundRecallInput {
  readonly adapter: string;
  readonly endpointKey: string;
  readonly message: OutboundMessage;
}

export type OutboundEndpointOperation = 'recall' | 'edit' | 'reaction' | 'typing';

export interface OutboundEndpointInput {
  readonly adapter: string;
  readonly endpointKey: string;
}

/**
 * Per-conversation-kind view of an Endpoint's capability profile (ADR 0044). Structurally the same as
 * `EndpointKindCapabilities` in `@zhin.js/im-contract`; a missing kind or field means "not supported".
 */
export interface OutboundKindCapabilities {
  readonly feedback?: Readonly<{
    mode: 'typing' | 'reaction' | 'status-message' | 'none';
    emoji?: string;
    text?: string;
    refreshSeconds?: number;
  }>;
  readonly reaction: boolean;
  readonly edit: boolean;
  readonly recall: boolean;
  readonly spool: boolean;
  /** Messages here must quote an inbound message. */
  readonly needsReply: boolean;
  readonly groupInfo: boolean;
  readonly memberProfile: boolean;
}

export interface OutboundEndpointCapabilities {
  readonly operations: readonly OutboundEndpointOperation[];
  readonly kinds?: Readonly<Partial<Record<'private' | 'group' | 'channel', OutboundKindCapabilities>>>;
}

export interface OutboundEditInput extends OutboundEndpointInput {
  readonly message: OutboundMessage;
  readonly content: unknown;
}

export interface OutboundTypingInput extends OutboundEndpointInput {
  readonly conversation: OutboundMessage['conversation'];
  readonly active?: boolean;
}


/** Structured message identity; structurally compatible with IM MessageRef. */
export interface OutboundMessage {
  readonly conversation: OutboundConversation & Readonly<{
    readonly endpoint: Readonly<{ readonly id: string; readonly adapter: string }>;
  }>;
  readonly id: string;
}

export interface OutboundHost {
  /** Sends to persisted exact identities, rejecting stale addresses instead of aliasing another bot. */
  sendTarget?(target: DeliveryTarget, content: unknown, options?: Readonly<{ locale?: Locale }>): Promise<string | null>;
  /** Runs related operations against one IM Runtime snapshot captured at ingress. */
  runWithView?<T>(operation: () => Promise<T>): Promise<T>;
  /** Exact operations declared by one live Endpoint. */
  capabilities?(input: OutboundEndpointInput): OutboundEndpointCapabilities | undefined;
  /**
   * Returns the platform message id, or null when delivery completed without
   * an id. Delivery failures reject; best-effort callers handle them explicitly.
   */
  send(input: OutboundSendInput): Promise<string | null>;
  /** Optional: platform message reactions (icqq group emoji, etc.). */
  addReaction?(input: OutboundReactionInput): Promise<string | null>;
  removeReaction?(input: OutboundRemoveReactionInput): Promise<void>;
  /** Optional: recall/delete a status message (activity-feedback autoRemove). */
  recall?(input: OutboundRecallInput): Promise<void>;
  /** Optional: update a previously sent status message. */
  edit?(input: OutboundEditInput): Promise<string | null>;
  /** Optional: toggle the platform-native typing indicator. */
  typing?(input: OutboundTypingInput): Promise<void>;
}

/** Root-only process port: requester is supplied by the owner-bound facade. */
export interface OutboundRootHost extends Omit<OutboundHost, 'sendTarget'> {
  sendTarget?(target: DeliveryTarget, content: unknown, requester: PluginId, options?: Readonly<{ locale?: Locale }>): Promise<string | null>;
}

/** Preserve the sending plugin as requester, independent of the destination endpoint owner. */
export class PluginOutboundHost implements OutboundHost {
  readonly sendTarget?: OutboundHost['sendTarget'];
  readonly runWithView?: OutboundHost['runWithView'];
  readonly capabilities?: OutboundHost['capabilities'];
  readonly addReaction?: OutboundHost['addReaction'];
  readonly removeReaction?: OutboundHost['removeReaction'];
  readonly recall?: OutboundHost['recall'];
  readonly edit?: OutboundHost['edit'];
  readonly typing?: OutboundHost['typing'];

  readonly #owner: PluginId;
  readonly #host: OutboundRootHost;
  readonly #admission?: GenerationAdmissionGate;
  readonly #operation: OwnerOperation;

  constructor(owner: PluginId, host: OutboundRootHost, admission?: GenerationAdmissionGate) {
    this.#owner = owner;
    this.#host = host;
    this.#admission = admission;
    this.#operation = new OwnerOperation(admission, 'Outbound');
    const sendTarget = host.sendTarget?.bind(host);
    const runWithView = host.runWithView?.bind(host);
    const capabilities = host.capabilities?.bind(host);
    const addReaction = host.addReaction?.bind(host);
    const removeReaction = host.removeReaction?.bind(host);
    const recall = host.recall?.bind(host);
    const edit = host.edit?.bind(host);
    const typing = host.typing?.bind(host);
    this.sendTarget = sendTarget ? async (target, content, options) => this.#run(() => options
      ? sendTarget(target, content, this.#owner, options)
      : sendTarget(target, content, this.#owner)) : undefined;
    this.runWithView = runWithView ? (operation) => this.#run(() => runWithView(operation)) : undefined;
    this.capabilities = capabilities ? (input) => this.#run(() => capabilities(input)) : undefined;
    this.addReaction = addReaction ? (input) => this.#run(() => addReaction(input)) : undefined;
    this.removeReaction = removeReaction ? (input) => this.#run(() => removeReaction(input)) : undefined;
    this.recall = recall ? (input) => this.#run(() => recall(input)) : undefined;
    this.edit = edit ? (input) => this.#run(() => edit(input)) : undefined;
    this.typing = typing ? (input) => this.#run(() => typing(input)) : undefined;
  }

  get owner(): PluginId { return this.#owner; }

  async send(input: OutboundSendInput): Promise<string | null> {
    return this.#run(() => this.#host.send(input));
  }

  /** @internal Bound by generation publication. */
  [generationAdmissionBinder](gate: GenerationAdmissionGate): PluginOutboundHost {
    return new PluginOutboundHost(this.#owner, this.#host, gate);
  }

  /** @internal Admission source collected by the Runtime. */
  get [generationAdmissionSource](): readonly GenerationAdmissionGate[] {
    return this.#admission ? [this.#admission] : [];
  }

  #run<T>(operation: () => T): T {
    return this.#operation.run(operation);
  }
}

/** @public Plugin-facing cross-platform outbound messaging Host. */
export const outboundHostToken = createToken<OutboundHost>(
  'zhin.outbound.host',
  'Plugin Runtime outbound push host',
);

/** Root-only process outbound port for composition and owner binding. */
export const outboundRootHostToken = createRootPrivateToken<OutboundRootHost>(
  'zhin.outbound.root-host',
  'Plugin Runtime root outbound host',
);
