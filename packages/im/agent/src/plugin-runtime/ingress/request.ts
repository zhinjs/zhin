import { personalSessionIdentity, samePersonalSessionAddress, type PersonalSessionAddress } from '../../personal-session/index.js';
import {
  collectSegmentMedia,
  toCanonicalSegments,
  type TurnCapabilities,
} from '@zhin.js/core';
import type { Message } from '@zhin.js/core/runtime';
import type {
  TurnAccessContext,
  TurnContextState,
  TurnInput,
  TurnIntent,
  TurnRequest,
  TurnRequestPorts,
} from '../../turn/turn-ingress.js';
import {
  turnIntentResolverToken,
  type TurnIntentResolver,
} from '../turn-intent-resolver.js';
import type { PluginId, RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import type { ConversationReference, ConversationResolution } from '@zhin.js/im-contract';
import {
  adapterLiveEndpointId,
  capabilityLocalName,
  resolveOwnerForRuntimeMessage,
  resolveRuntimeSenderRoles,
  resolveRuntimeTurnCapabilities,
  resolveRuntimeTurnContextState,
  runtimeApprovalPolicy,
  turnFactCacheSize,
  TURN_FACT_CACHE_MAX_ENTRIES,
  TURN_FACT_CACHE_TTL_MS,
  type EndpointOwnerResolver,
  type RuntimeSenderRoles,
  type RuntimeTurnContextRequest,
  type SceneFactDeps,
} from './request-capabilities.js';
import {
  approvalMessages,
  createDeterministicApprovalPort,
  createRuntimeApprovalPort,
  createRuntimeQuestionPort,
  createRuntimeTurnAccess,
  deliveryOutcomeFromReceipt,
  interactiveNetworkPolicy,
  resolveImApprover,
  resolveMasterShellApprovalMode,
  resolveSandboxTurnPolicy,
  runtimeImSessionKey,
  runtimePersonalSessionAddress,
  runtimeSceneTaskSessionKey,
  type ImApprover,
  type ImApproverInput,
  type ResolvedSandboxTurnPolicy,
  type SandboxTurnPolicyInput,
} from './request-ports.js';

export {
  adapterLiveEndpointId,
  approvalMessages,
  capabilityLocalName,
  createDeterministicApprovalPort,
  createRuntimeApprovalPort,
  createRuntimeQuestionPort,
  createRuntimeTurnAccess,
  deliveryOutcomeFromReceipt,
  interactiveNetworkPolicy,
  resolveImApprover,
  resolveMasterShellApprovalMode,
  resolveOwnerForRuntimeMessage,
  resolveRuntimeSenderRoles,
  resolveRuntimeTurnCapabilities,
  resolveRuntimeTurnContextState,
  resolveSandboxTurnPolicy,
  runtimeApprovalPolicy,
  runtimeImSessionKey,
  runtimePersonalSessionAddress,
  runtimeSceneTaskSessionKey,
  turnFactCacheSize,
  TURN_FACT_CACHE_MAX_ENTRIES,
  TURN_FACT_CACHE_TTL_MS,
  type EndpointOwnerResolver,
  type ImApprover,
  type ImApproverInput,
  type ResolvedSandboxTurnPolicy,
  type RuntimeSenderRoles,
  type RuntimeTurnContextRequest,
  type SandboxTurnPolicyInput,
  type SceneFactDeps,
};

/** Immutable source facts; execution authority remains in the separate operation input. */
export interface RuntimeTurnMessageFacts {
  readonly message: Message;
  readonly text: string;
  readonly roles: RuntimeSenderRoles;
}

/** Existing policy, ports and lifetime for this one TurnRequest; never retained as global state. */
export interface RuntimeTurnExecutionOptions {
  /**
   * Pre-narrowed access (ADR 0038 §2 merged turn); must originate from this
   * message's conversation. Default: the message sender's own access.
   */
  readonly access?: TurnAccessContext;
  readonly traceId: string;
  readonly turnId: string;
  readonly signal: AbortSignal;
  /** Trusted Host project namespace, independent of the tool workspace. */
  readonly projectRoot: string;
  readonly workspaceRoot: string;
  readonly workingDirectory?: string;
  readonly filesystemAccess?: NonNullable<TurnRequest['policy']['filesystem']>['access'];
  readonly shell?: TurnRequest['policy']['shell'];
  readonly network?: TurnRequest['policy']['network'];
  readonly sessionKey?: string;
  /** Trusted personal owner address; explicit system/Workroom sessions omit it. */
  readonly personalSession?: PersonalSessionAddress;
  readonly intent: TurnIntent;
  readonly ports: TurnRequestPorts;
  readonly resolveReference?: (
    reference: ConversationReference,
    options: Readonly<{ depth: number; maxEntries: number; maxChars: number }>,
    signal: AbortSignal,
  ) => Promise<ConversationResolution>;
  readonly readConversationContext?: (consumer: string, signal: AbortSignal) => Promise<Readonly<{
    blocks: readonly import('@zhin.js/im-contract').ConversationContextBlock[];
    cursor: number;
  }>>;
  readonly commitConversationContext?: (consumer: string, cursor: number) => Promise<void>;
  /** Configuration-owned metadata; applied after untrusted adapter metadata. */
  readonly trustedMetadata?: Readonly<Record<string, unknown>>;
  /** Facts read from the operation's Endpoint, independently of message metadata. */
  readonly contextState?: TurnContextState;
  /** ADR 0044: capabilities resolved once for this turn (see {@link resolveRuntimeTurnCapabilities}). */
  readonly platformCapabilities?: TurnCapabilities;
  /** Canonical SSOT sequence number (`conversation_events.sequence`) when backed by an IM event. */
  readonly conversationSequence?: number;
  /** #996: short scene event summaries for the ephemeral `[Scene events]` block (newest first). */
  readonly sceneEvents?: readonly string[];
  /** ADR 0038 §3: senders of a merged turn (two or more). */
  readonly mergedSenders?: TurnInput['mergedSenders'];
  /** ADR 0038 §5: the danmaku window of a live-stream turn. */
  readonly liveDanmaku?: TurnInput['liveDanmaku'];
}

/**
 * Canonical IM → Agent TurnRequest mapper. Runtime Message remains owned by IM.
 */
export function createRuntimeTurnRequest(
  { message, text, roles }: RuntimeTurnMessageFacts,
  input: RuntimeTurnExecutionOptions,
): TurnRequest {
  const access = input.access ?? createRuntimeTurnAccess(
    message,
    roles,
    input.contextState,
    input.platformCapabilities,
    input.conversationSequence,
  );
  const origin = access.origin;
  if (origin.kind !== 'im') throw new Error('Runtime IM ingress must produce an IM origin');
  const clientAdapter = message.clientAdapter;
  const mediaEntries = collectSegmentMedia(
    message.segments ? toCanonicalSegments(message.segments) : undefined,
  ).map(({ type, media: ref }) => Object.freeze({
    kind: type as 'image' | 'audio' | 'video' | 'file',
    source: Object.freeze({
      kind: ref.kind === 'file' ? 'platform_ref' as const : ref.kind,
      value: ref.value,
    }),
    ...(ref.mime_type ? { mimeType: ref.mime_type } : {}),
    ...(ref.file_name ? { name: ref.file_name } : {}),
  }));
  const conversationReferences: ConversationReference[] = [];
  if (message.replyTo?.id) {
    conversationReferences.push(Object.freeze({
      kind: 'message',
      message: Object.freeze({ conversation: message.conversation, id: message.replyTo.id }),
    }));
  }
  for (const segment of toCanonicalSegments(message.segments ?? [])) {
    if (segment.type !== 'forward') continue;
    const forwardId = String(segment.data.forward_id ?? '').trim();
    if (!forwardId) continue;
    conversationReferences.push(Object.freeze({
      kind: 'forward',
      conversation: message.conversation,
      forwardId,
    }));
  }
  for (const entry of mediaEntries) {
    if (entry.source.kind !== 'platform_ref') continue;
    conversationReferences.push(Object.freeze({
      kind: 'media',
      conversation: message.conversation,
      media: Object.freeze({
        kind: 'file',
        value: entry.source.value,
        ...(entry.mimeType ? { mime_type: entry.mimeType } : {}),
        ...(entry.name ? { file_name: entry.name } : {}),
      }),
    }));
  }
  const turnReferences = conversationReferences.map((reference, index) => Object.freeze({
    key: `ref-${index + 1}`,
    kind: reference.kind,
    sourceId: reference.kind === 'message'
      ? reference.message.id
      : reference.kind === 'forward'
        ? reference.forwardId
        : reference.media.value,
  }));
  const referenceByKey = new Map<string, ConversationReference>(turnReferences.map((reference, index) => [
    reference.key,
    conversationReferences[index]!,
  ]));
  const media = mediaEntries.map((entry) => {
    if (entry.source.kind !== 'platform_ref') return entry;
    const reference = turnReferences.find((candidate) => candidate.kind === 'media' && candidate.sourceId === entry.source.value);
    return Object.freeze({ ...entry, ...(reference ? { referenceKey: reference.key } : {}) });
  });
  if (turnReferences.length > 0 && !input.resolveReference) {
    throw new TypeError('Runtime IM references require a generation-bound resolver');
  }
  const referencePort = turnReferences.length > 0
    ? Object.freeze({
        resolve: async (
          key: string,
          options: Readonly<{ depth: number; maxEntries: number; maxChars: number }>,
          signal: AbortSignal,
        ) => {
          const reference = referenceByKey.get(key);
          if (!reference) return Object.freeze({ status: 'forbidden' as const, code: 'reference_not_in_turn' });
          const result = await input.resolveReference!(reference, options, signal);
          if (result.status !== 'resolved') return result;
          const bounded = boundReferenceContent(result.value, options);
          return Object.freeze({
            status: 'resolved' as const,
            content: bounded.content,
            ...(bounded.truncated ? { truncated: true } : {}),
          });
        },
      })
    : undefined;
  // Public conversation facts have an independent cursor for each personal Session.
  // Workroom and other explicit system domains supply their own session key.
  const personalSession = input.personalSession
    ? personalSessionIdentity(input.personalSession).address
    : input.sessionKey ? undefined : runtimePersonalSessionAddress(access, input.projectRoot);
  const sessionKey = input.sessionKey ?? personalSessionIdentity(personalSession!).key;
  if (personalSession && (!samePersonalSessionAddress(personalSession, runtimePersonalSessionAddress(access, input.projectRoot))
    || personalSessionIdentity(personalSession).key !== sessionKey)) {
    throw new TypeError('Personal Session must match the authenticated ingress address and key');
  }
  const contextConsumer = `agent-session:${sessionKey}`;
  const conversationContext = input.readConversationContext && input.commitConversationContext
    ? Object.freeze({
        readPending: (signal: AbortSignal) => input.readConversationContext!(contextConsumer, signal),
        commit: (cursor: number) => input.commitConversationContext!(contextConsumer, cursor),
      })
    : undefined;

  return Object.freeze({
    identity: Object.freeze({ traceId: input.traceId, turnId: input.turnId }),
    origin,
    principal: access.principal,
    intent: Object.freeze({ ...input.intent }),
    input: Object.freeze({
      text,
      locale: message.locale,
      ...(message.commandPrefix !== undefined ? { commandPrefix: message.commandPrefix } : {}),
      ...(message.commandMenu !== undefined ? { commandMenu: message.commandMenu } : {}),
      ...(media.length > 0 ? { media: Object.freeze(media) } : {}),
      ...(turnReferences.length > 0 ? { references: Object.freeze(turnReferences) } : {}),
      metadata: Object.freeze({ ...message.metadata, ...input.trustedMetadata }),
      ...(input.contextState ? { contextState: input.contextState } : {}),
      ...(input.platformCapabilities ? { platformCapabilities: input.platformCapabilities } : {}),
      ...(input.sceneEvents?.length ? { sceneEvents: Object.freeze([...input.sceneEvents]) } : {}),
      ...(input.mergedSenders && input.mergedSenders.length > 1 ? { mergedSenders: Object.freeze([...input.mergedSenders]) } : {}),
      ...(input.liveDanmaku ? { liveDanmaku: input.liveDanmaku } : {}),
    }),
    session: Object.freeze({
      key: sessionKey,
      ...(personalSession ? { personal: personalSession } : {}),
    }),
    policy: Object.freeze({
      ...access.policy,
      filesystem: Object.freeze({
        workspaceRoot: input.workspaceRoot,
        ...(input.workingDirectory ? { workingDirectory: input.workingDirectory } : {}),
        ...(input.filesystemAccess ? { access: input.filesystemAccess } : {}),
      }),
      ...(input.shell ? { shell: Object.freeze({ ...input.shell }) } : {}),
      ...(input.network ? { network: Object.freeze({
        enabled: input.network.enabled,
        httpsOnly: input.network.httpsOnly,
        allowedDomains: Object.freeze([...(input.network.allowedDomains ?? [])]),
      }) } : {}),
    }),
    signal: input.signal,
    ports: Object.freeze({
      ...input.ports,
      ...(clientAdapter ? { client: Object.freeze({
        adapter: clientAdapter,
        get: () => message.$client,
      }) } : {}),
      ...(referencePort ? { references: referencePort } : {}),
      ...(conversationContext ? { conversationContext } : {}),
    }),
  });
}

function boundReferenceContent(
  input: unknown,
  options: Readonly<{ depth: number; maxEntries: number; maxChars: number }>,
): Readonly<{ content: unknown; truncated: boolean }> {
  if (
    input && typeof input === 'object'
    && ['url', 'path', 'base64', 'file'].includes(String((input as { kind?: unknown }).kind ?? ''))
    && typeof (input as { value?: unknown }).value === 'string'
  ) {
    return Object.freeze({ content: input, truncated: false });
  }
  let remainingChars = Math.max(0, options.maxChars);
  let remainingEntries = Math.max(0, options.maxEntries);
  let truncated = false;
  const seen = new WeakSet<object>();

  const visit = (value: unknown, depth: number, key?: string): unknown => {
    if (typeof value === 'string') {
      if (remainingChars <= 0) {
        truncated = true;
        return '';
      }
      if (value.length <= remainingChars) {
        remainingChars -= value.length;
        return value;
      }
      const result = value.slice(0, remainingChars);
      remainingChars = 0;
      truncated = true;
      return `${result}…[truncated]`;
    }
    if (value == null || typeof value !== 'object') return value;
    if (seen.has(value)) {
      truncated = true;
      return '[cycle omitted]';
    }
    seen.add(value);
    if (Array.isArray(value)) {
      const isForwardEntries = key === 'entries' || (key === undefined && depth === 0);
      if (isForwardEntries && depth > options.depth) {
        truncated = true;
        return [];
      }
      const take = isForwardEntries ? Math.min(value.length, remainingEntries) : value.length;
      if (isForwardEntries) remainingEntries -= take;
      if (isForwardEntries && take < value.length) truncated = true;
      return Object.freeze(value.slice(0, take).map((item) => visit(item, isForwardEntries ? depth + 1 : depth)));
    }
    const output: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      output[childKey] = visit(childValue, depth, childKey);
    }
    return Object.freeze(output);
  };

  return Object.freeze({ content: visit(input, 0), truncated });
}

/**
 * Trusted adapter metadata may select an active-turn coordination intent.
 * Unknown/malformed values fail closed instead of silently becoming supersede.
 */
export function resolveRuntimeTurnIntent(
  message: Message,
  groupMode: 'supersede' | 'fifo' = 'supersede',
): TurnIntent {
  const raw = message.metadata?.turnIntent;
  if (raw === undefined) {
    return Object.freeze({
      kind: groupMode === 'fifo' && isGroupOrChannelRuntimeMessage(message) ? 'new' : 'supersede',
    });
  }
  if (!raw || typeof raw !== 'object') {
    throw new TypeError('Runtime turnIntent metadata must be an object');
  }
  const record = raw as Record<string, unknown>;
  const kind = record.kind;
  if (!['new', 'steer', 'follow_up', 'supersede', 'observe'].includes(String(kind))) {
    throw new TypeError(`Runtime turnIntent kind is invalid: ${String(kind)}`);
  }
  const targetTurnId = record.targetTurnId;
  if (targetTurnId !== undefined && (typeof targetTurnId !== 'string' || !targetTurnId.trim())) {
    throw new TypeError('Runtime turnIntent targetTurnId must be a non-empty string');
  }
  const authorizedBy = record.authorizedBy;
  if (authorizedBy !== undefined) {
    throw new TypeError('Runtime turnIntent authorizedBy must be supplied by trusted product policy');
  }
  return Object.freeze({
    kind: kind as TurnIntent['kind'],
    ...(targetTurnId ? { targetTurnId } : {}),
  });
}

/**
 * True when the message carries only text: no media, quoted message or
 * forward. Only such messages may be merged into another turn (#725), because
 * a merged turn keeps the attachments of its first message only.
 */
export function isPlainTextRuntimeMessage(message: Message): boolean {
  if (message.replyTo?.id) return false;
  const segments = message.segments ? toCanonicalSegments(message.segments) : [];
  if (segments.some((segment) => segment.type === 'forward')) return false;
  return collectSegmentMedia(segments).length === 0;
}

function isGroupOrChannelRuntimeMessage(message: Message): boolean {
  return message.conversation.kind === 'group' || message.conversation.kind === 'channel';
}

export function resolveSnapshotTurnIntentResolver(
  snapshot: Pick<RuntimeSnapshot, 'resources'>,
  requester: PluginId,
): TurnIntentResolver | undefined {
  const candidate = snapshot.resources.get(requester)?.get(turnIntentResolverToken.id);
  return typeof candidate === 'function' ? candidate as TurnIntentResolver : undefined;
}

export async function resolveProductTurnIntent(
  message: Message,
  senderRoles: Readonly<RuntimeSenderRoles>,
  groupMode: 'supersede' | 'fifo' | undefined,
  resolver: TurnIntentResolver | undefined,
): Promise<TurnIntent> {
  const defaultIntent = resolveRuntimeTurnIntent(message, groupMode);
  if (!resolver) return defaultIntent;
  const resolved = await resolver(Object.freeze({ message, senderRoles, defaultIntent }));
  return Object.freeze({ ...resolved });
}
