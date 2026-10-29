import {
  collectSegmentMedia,
  toCanonicalSegments,
  type AITriggerConfig,
} from '@zhin.js/core';
import type { ImRuntime, Message } from '@zhin.js/core/runtime';
import type { UserInteraction } from '@zhin.js/interaction';
import { adapterFeatureId, isAdapterIndex, resolveEndpointManagement } from '@zhin.js/adapter';
import { formatCompact, getLogger } from '@zhin.js/logger';
import {
  approvalOutcomeToDecision,
  type AIService,
  type ApprovalDecision,
  type ApprovalDecisionMemory,
  type ApprovalDecisionPort,
  type ApprovalOutcome,
  type ApprovalOutcomePort,
  type ApprovalRequestInput,
  type DeliveryOutcome,
  type TurnAccessContext,
  type TurnContextState,
  type TurnInput,
  type TurnIntent,
  type TurnRequest,
  type TurnRequestPorts,
} from '@zhin.js/agent';
import {
  turnIntentResolverToken,
  type ToolCapability,
  type TurnIntentResolver,
} from '@zhin.js/agent/runtime';
import { resolveLocale, type Locale, type PluginId, type RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import { approvalMessages as approvalText } from './approval-messages.js';
import type { ConversationRef, ConversationReference, ConversationResolution } from '@zhin.js/im-contract';

type EndpointOwnerResolver = (adapterLocalName: string, endpointKey: string) => string | undefined;
type EndpointTrustedResolver = (adapterLocalName: string, endpointKey: string) => readonly string[];
const logger = getLogger('agent');

export interface RuntimeSenderRoles {
  readonly isMaster: boolean;
  readonly isTrusted: boolean;
}

/** ADR 0041 §6: scene/sender facts are reused for at most this long. */
export const TURN_FACT_CACHE_TTL_MS = 60_000;
/** Upper bound of cached lookups per generation (scenes + senders). */
export const TURN_FACT_CACHE_MAX_ENTRIES = 256;
const MAX_ADMIN_IDS = 20;
const KEY_SEP = '\u0000';

interface FactCacheEntry { readonly at: number; readonly value: unknown }

/** Bounded in-memory TTL cache; only successful lookups are stored. */
class TurnFactCache {
  readonly #entries = new Map<string, FactCacheEntry>();
  get<T>(key: string, now: number): T | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;
    if (now - entry.at >= TURN_FACT_CACHE_TTL_MS) { this.#entries.delete(key); return undefined; }
    return entry.value as T;
  }
  set(key: string, value: unknown, now: number): void {
    this.#entries.delete(key);
    if (this.#entries.size >= TURN_FACT_CACHE_MAX_ENTRIES) {
      for (const [k, entry] of this.#entries) {
        if (now - entry.at >= TURN_FACT_CACHE_TTL_MS) this.#entries.delete(k);
      }
      while (this.#entries.size >= TURN_FACT_CACHE_MAX_ENTRIES) {
        const oldest = this.#entries.keys().next();
        if (oldest.done) break;
        this.#entries.delete(oldest.value);
      }
    }
    this.#entries.set(key, { at: now, value });
  }
  get size(): number { return this.#entries.size; }
}

/** Keyed by the generation's adapter index, so a disposed generation's cache is unreachable and collected. */
const factCaches = new WeakMap<object, TurnFactCache>();

function factCacheFor(owner: object): TurnFactCache {
  let cache = factCaches.get(owner);
  if (!cache) factCaches.set(owner, cache = new TurnFactCache());
  return cache;
}

/** Number of cached lookups for a generation's adapter index (tests / diagnostics). */
export function turnFactCacheSize(owner: object): number {
  return factCaches.get(owner)?.size ?? 0;
}

async function raceSignal<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let onAbort!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try { return await Promise.race([task, aborted]); } finally { signal.removeEventListener('abort', onAbort); }
}

async function cachedLookup<T>(
  cache: TurnFactCache, key: string, signal: AbortSignal, lookup: () => Promise<T>,
): Promise<T | undefined> {
  const hit = cache.get<T>(key, Date.now());
  if (hit !== undefined) return hit;
  try {
    const value = await raceSignal(lookup(), signal);
    cache.set(key, value, Date.now());
    return value;
  } catch (error) {
    signal.throwIfAborted();
    logger.debug(formatCompact({
      op: 'agent_scene_fact_lookup_failed', kind: key.split(KEY_SEP)[0],
      error: error instanceof Error ? error.message : String(error),
    }));
    return undefined;
  }
}

/**
 * Resolve this turn's account and, for ICQQ groups, the ADR 0041 scene facts (group, Bot role and
 * card, sender role/card/title/mute) before tool discovery. The Bot role is always read fresh;
 * group and sender facts reuse a short per-generation cache. Failed lookups omit their fields.
 */
export async function resolveRuntimeTurnContextState(
  snapshot: Pick<RuntimeSnapshot, 'projections'>,
  conversation: ConversationRef,
  signal: AbortSignal,
  senderId?: string,
): Promise<TurnContextState | undefined> {
  signal.throwIfAborted();
  const adapters = snapshot.projections?.get(adapterFeatureId);
  if (!isAdapterIndex(adapters)) return undefined;
  const endpointId = conversation.endpoint.id;
  const endpoint = adapters.connection(endpointId, endpointId);
  const id = endpoint?.selfUserId;
  if (!id) return undefined;
  const bot: NonNullable<TurnContextState['bot']> = { id };
  if (conversation.endpoint.adapter !== 'icqq' || conversation.kind !== 'group') {
    return Object.freeze({ bot: Object.freeze(bot) });
  }
  const management = resolveEndpointManagement(endpoint);
  if (!management?.inspectGroupMember && !management?.inspectGroupMemberProfile) {
    return Object.freeze({ bot: Object.freeze({ ...bot, platformRoleError: 'unsupported' }) });
  }
  const cache = factCacheFor(adapters);
  const group = conversation.id;
  const scopeKey = `${endpointId}${KEY_SEP}${group}`;
  const sender = senderId && senderId !== id ? senderId : undefined;

  const botTask = (async (): Promise<NonNullable<TurnContextState['bot']>> => {
    try {
      if (management.inspectGroupMemberProfile) {
        const member = await raceSignal(management.inspectGroupMemberProfile(group, id, signal), signal);
        return {
          ...bot,
          ...(member.platformRole ? { platformRole: member.platformRole } : { platformRoleError: 'unavailable' }),
          ...(member.card ? { nickname: member.card } : {}),
          ...(member.mutedUntil !== undefined ? { mutedUntil: member.mutedUntil } : {}),
        };
      }
      const member = await raceSignal(management.inspectGroupMember!(group, id, signal), signal);
      return { ...bot, ...(member.platformRole ? { platformRole: member.platformRole } : { platformRoleError: 'unavailable' }) };
    } catch (error) {
      signal.throwIfAborted();
      logger.warn(formatCompact({
        op: 'agent_bot_role_lookup_failed', endpoint: endpointId, group,
        error: error instanceof Error ? error.message : String(error),
      }));
      return { ...bot, platformRoleError: 'lookup_failed' };
    }
  })();
  const sceneTask = management.inspectGroupScene
    ? cachedLookup(cache, `scene${KEY_SEP}${scopeKey}`, signal, () => management.inspectGroupScene!(group, signal))
    : Promise.resolve(undefined);
  const senderTask = sender && management.inspectGroupMemberProfile
    ? cachedLookup(cache, `member${KEY_SEP}${scopeKey}${KEY_SEP}${sender}`, signal,
        () => management.inspectGroupMemberProfile!(group, sender, signal))
    : Promise.resolve(undefined);
  const [resolvedBot, scene, member] = await Promise.all([botTask, sceneTask, senderTask]);
  signal.throwIfAborted();

  const conversationFacts: Record<string, unknown> = {};
  if (scene?.name) conversationFacts.name = scene.name;
  if (scene?.ownerId) conversationFacts.ownerId = scene.ownerId;
  if (scene?.adminIds) conversationFacts.adminIds = Object.freeze(scene.adminIds.slice(0, MAX_ADMIN_IDS));
  if (scene?.memberCount !== undefined) conversationFacts.memberCount = scene.memberCount;
  if (scene?.muteAll !== undefined) conversationFacts.muteAll = scene.muteAll;
  const senderFacts: Record<string, unknown> = {};
  if (member?.platformRole) senderFacts.platformRole = member.platformRole;
  if (member?.card) senderFacts.groupNickname = member.card;
  if (member?.title) senderFacts.groupTitle = member.title;
  if (member?.mutedUntil !== undefined) senderFacts.mutedUntil = member.mutedUntil;
  return Object.freeze({
    bot: Object.freeze(resolvedBot),
    ...(Object.keys(conversationFacts).length
      ? { conversation: Object.freeze(conversationFacts) as NonNullable<TurnContextState['conversation']> } : {}),
    ...(Object.keys(senderFacts).length
      ? { sender: Object.freeze(senderFacts) as NonNullable<TurnContextState['sender']> } : {}),
  });
}


/**
 * Sender roles derive only from the authenticated Message sender reference.
 * trigger.masters and endpoint master grant master; trusted remains weaker.
 */
export function resolveRuntimeSenderRoles(
  message: Message,
  endpointMaster: string | undefined,
  endpointTrusted: readonly string[],
  trigger?: AITriggerConfig,
): RuntimeSenderRoles {
  const senderId = message.sender?.id;
  const triggerMasters = (trigger?.masters ?? []).map(String);
  const triggerTrusted = (trigger?.trusted ?? []).map(String);
  const isMaster = senderId != null
    && ((endpointMaster != null && senderId === String(endpointMaster))
      || triggerMasters.includes(senderId));
  const isTrusted = !isMaster && senderId != null
    && (triggerTrusted.includes(senderId) || endpointTrusted.map(String).includes(senderId));
  return { isMaster, isTrusted };
}

/**
 * Canonical IM → Agent TurnRequest mapper. Runtime Message remains owned by IM.
 */
export function createRuntimeTurnRequest(
  message: Message,
  text: string,
  roles: RuntimeSenderRoles,
  input: Readonly<{
    /**
     * Pre-narrowed access (ADR 0038 §2 merged turn); must originate from this
     * message's conversation. Default: the message sender's own access.
     */
    access?: TurnAccessContext;
    traceId: string;
    turnId: string;
    signal: AbortSignal;
    workspaceRoot: string;
    workingDirectory?: string;
    filesystemAccess?: NonNullable<TurnRequest['policy']['filesystem']>['access'];
    shell?: TurnRequest['policy']['shell'];
    network?: TurnRequest['policy']['network'];
    sessionKey?: string;
    intent: TurnIntent;
    ports: TurnRequestPorts;
    resolveReference?: (
      reference: ConversationReference,
      options: Readonly<{ depth: number; maxEntries: number; maxChars: number }>,
      signal: AbortSignal,
    ) => Promise<ConversationResolution>;
    readConversationContext?: (consumer: string, signal: AbortSignal) => Promise<Readonly<{
      blocks: readonly import('@zhin.js/im-contract').ConversationContextBlock[];
      cursor: number;
    }>>;
    commitConversationContext?: (consumer: string, cursor: number) => Promise<void>;
    /** Configuration-owned metadata; applied after untrusted adapter metadata. */
    trustedMetadata?: Readonly<Record<string, unknown>>;
    /** Facts read from the operation's Endpoint, independently of message metadata. */
    contextState?: TurnContextState;
    /** #996: short scene event summaries for the ephemeral `[Scene events]` block (newest first). */
    sceneEvents?: readonly string[];
    /** ADR 0038 §3: senders of a merged turn (two or more). */
    mergedSenders?: TurnInput['mergedSenders'];
    /** ADR 0038 §5: the danmaku window of a live-stream turn. */
    liveDanmaku?: TurnInput['liveDanmaku'];
  }>,
): TurnRequest {
  const access = input.access ?? createRuntimeTurnAccess(message, roles, input.contextState);
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
  // Conversation events belong to the Agent session, not to whichever principal
  // happened to trigger the next turn in a shared room.
  const sessionKey = input.sessionKey ?? runtimeImSessionKey(access);
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
      ...(input.sceneEvents?.length ? { sceneEvents: Object.freeze([...input.sceneEvents]) } : {}),
      ...(input.mergedSenders && input.mergedSenders.length > 1 ? { mergedSenders: Object.freeze([...input.mergedSenders]) } : {}),
      ...(input.liveDanmaku ? { liveDanmaku: input.liveDanmaku } : {}),
    }),
    session: Object.freeze({
      key: sessionKey,
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

/** IM adapter for the origin-neutral interaction authority. */
export function createRuntimeQuestionPort(
  im: ImRuntime,
  message: Message,
): NonNullable<TurnRequestPorts['question']> {
  const interaction = im.createInteraction(message);
  if (!interaction) throw new Error('User interaction is unavailable for this message');
  return Object.freeze({
    async ask(request: Parameters<NonNullable<TurnRequestPorts['question']>['ask']>[0]) {
      const options = {
        ...(request.timeoutMs !== undefined ? { timeout: request.timeoutMs } : {}),
        ...(request.defaultValue !== undefined ? { default: request.defaultValue } : {}),
        signal: request.signal,
      };
      if (request.type === 'text') {
        const value = await interaction.ask({ type: 'text', title: request.question, ...options });
        return Object.freeze({ type: 'text' as const, value });
      }
      if (request.type === 'number') {
        const numericDefault = request.defaultValue === undefined
          ? undefined
          : Number(request.defaultValue);
        const value = await interaction.ask({
          type: 'number',
          title: request.question,
          ...(request.timeoutMs !== undefined ? { timeout: request.timeoutMs } : {}),
          ...(Number.isFinite(numericDefault) ? { default: numericDefault } : {}),
          signal: request.signal,
        });
        return Object.freeze({ type: 'number' as const, value });
      }
      if (request.type === 'confirm') {
        const value = await interaction.ask({
          type: 'confirm',
          title: request.question,
          ...(request.timeoutMs !== undefined ? { timeout: request.timeoutMs } : {}),
          ...(request.defaultValue !== undefined
            ? { default: /^(?:y|yes|true|1|是|确认|同意)$/i.test(request.defaultValue) }
            : {}),
          signal: request.signal,
        });
        return Object.freeze({ type: 'confirm' as const, value });
      }
      const choices = request.options ?? [];
      const value = await interaction.ask({
        type: 'select',
        title: request.question,
        options: choices.map((label) => ({ label, value: label })),
        ...(request.timeoutMs !== undefined ? { timeout: request.timeoutMs } : {}),
        ...(request.defaultValue !== undefined ? { default: request.defaultValue } : {}),
        signal: request.signal,
      }) as string;
      return Object.freeze({ type: 'pick' as const, value, index: choices.indexOf(value) });
    },
  });
}

/** IM approvals use UserInteraction; human-only tools also require a fresh answer from masters. */
export function createRuntimeApprovalPort(options: {
  readonly locale?: Locale;
  readonly isMaster: boolean;
  readonly interaction?: UserInteraction;
  readonly memory?: ApprovalDecisionMemory;
}): ApprovalDecisionPort & ApprovalOutcomePort {
  const locale = resolveLocale(options.locale);
  const port: ApprovalDecisionPort & ApprovalOutcomePort = {
    available: options.isMaster || options.interaction != null,
    async requestApprovalOutcome(input: ApprovalRequestInput): Promise<ApprovalOutcome> {
      if (options.isMaster && !input.humanOnly) return { status: 'approved', decision: 'approve-always' };
      if (!options.interaction) {
        return { status: 'unavailable', reason: 'this conversation cannot show an approval prompt' };
      }
      const recalled = input.humanOnly ? undefined : options.memory?.recall(input);
      if (recalled !== undefined) {
        return recalled
          ? { status: 'approved', decision: 'approve-always' }
          : { status: 'denied', by: 'remembered' };
      }
      const sharedConversation = input.conversationScope === 'group'
        || input.conversationScope === 'channel';
      try {
        // No `default`: a timeout must surface as timed_out, not as a silent rejection.
        const selected = await options.interaction.ask({
          type: 'select',
          title: approvalText(locale, 'title'),
          description: input.question,
          tip: approvalText(locale, input.humanOnly ? 'humanTip' : 'tip'),
          options: [
            { label: approvalText(locale, input.humanOnly ? 'reject' : 'rejectAlways'), value: 'reject',
              aliases: locale === 'en' ? ['n', 'no', 'Reject'] : ['否', '拒绝'] },
            { label: approvalText(locale, 'once'), value: 'approve-once', aliases: locale === 'en' ? ['y', 'yes'] : ['同意', '确认'] },
            ...(sharedConversation && !input.humanOnly ? [
              { label: approvalText(locale, 'sessionLabel'), value: 'approve-session', aliases: [approvalText(locale, 'session')] },
            ] : []),
            ...(!input.humanOnly ? [{
              label: approvalText(locale, 'alwaysLabel'),
              value: 'approve-always',
              aliases: [approvalText(locale, 'always')],
            }] : []),
          ],
          ...(input.timeoutMs !== undefined ? { timeout: input.timeoutMs } : {}),
          signal: input.signal,
        });
        const decision = input.humanOnly
          ? selected === 'approve-once' ? 'approve-once' : 'reject'
          : normalizeApprovalDecision(selected, sharedConversation);
        if (!input.humanOnly) options.memory?.remember(input, decision);
        return decision === 'reject' ? { status: 'denied', by: 'user' } : { status: 'approved', decision };
      } catch (error) {
        return approvalOutcomeFromInteractionError(error);
      }
    },
    async requestApprovalDecision(input: ApprovalRequestInput): Promise<ApprovalDecision> {
      return approvalOutcomeToDecision(await port.requestApprovalOutcome(input));
    },
    async requestApproval(input: ApprovalRequestInput) {
      return (await port.requestApprovalOutcome(input)).status === 'approved';
    },
  };
  return Object.freeze(port);
}

function approvalOutcomeFromInteractionError(error: unknown): ApprovalOutcome {
  const name = error instanceof Error ? error.name : '';
  switch (name) {
    case 'UserInteractionTimeoutError':
      return { status: 'timed_out' };
    case 'UserInteractionDeliveryError':
      return { status: 'unavailable', reason: 'the approval prompt could not be delivered' };
    case 'UserInteractionSupersededError':
      return { status: 'unavailable', reason: 'the approval prompt was superseded by another question' };
    default:
      return { status: 'unavailable', reason: 'the approval prompt failed' };
  }
}

function normalizeApprovalDecision(value: unknown, sharedConversation: boolean): ApprovalDecision {
  if (value === 'reject' || value === 'approve-once' || value === 'approve-always') return value;
  if (sharedConversation && value === 'approve-session') return value;
  return 'reject';
}

export function deliveryOutcomeFromReceipt(
  receipt: Awaited<ReturnType<Message['$reply']>>,
): DeliveryOutcome {
  switch (receipt.status) {
    case 'sent':
      return {
        status: 'sent' as const,
        ...(receipt.message?.id
          ? { messageId: receipt.message.id }
          : {}),
      };
    case 'suppressed':
      return { status: 'suppressed' as const };
    case 'unsupported':
      return {
        status: 'unsupported' as const,
        code: receipt.failure?.code ?? 'outbound_unsupported',
      };
    case 'rejected':
      return {
        status: 'rejected' as const,
        code: receipt.failure?.code ?? 'outbound_payload_rejected',
      };
    case 'failed':
      return {
        status: 'failed' as const,
        code: receipt.failure?.code ?? 'endpoint_send_failed',
        retryable: receipt.failure?.retryable === true,
      };
  }
}

export function interactiveNetworkPolicy(
  config: ReturnType<AIService['getAgentConfig']>,
): TurnRequest['policy']['network'] | undefined {
  const network = config?.network;
  // An explicit `network.enabled` wins; unset keeps the legacy `execPreset: network` switch.
  const enabled = network?.enabled ?? config?.execPreset === 'network';
  if (!enabled) return undefined;
  const allowedDomains = (network?.allowedDomains ?? [])
    .map(domain => String(domain).trim())
    .filter(Boolean);
  return Object.freeze({ enabled: true, httpsOnly: true, allowedDomains: Object.freeze(allowedDomains) });
}

export function createRuntimeTurnAccess(
  message: Message,
  roles: RuntimeSenderRoles,
  contextState?: TurnContextState,
): TurnAccessContext {
  const platform = capabilityLocalName(String(message.conversation.endpoint.id));
  const endpoint = message.endpointId?.trim();
  if (!endpoint) throw new TypeError('Runtime IM ingress requires endpoint identity');
  const subjectId = message.sender?.id?.trim();
  if (!subjectId) throw new TypeError('Runtime IM ingress requires authenticated sender identity');
  // Fail closed: only human-origin messages may construct an agent turn.
  const messageOrigin = message.origin;
  if (messageOrigin !== undefined && messageOrigin !== 'human') {
    throw new TypeError(`Runtime IM ingress rejects non-human origin: ${String(messageOrigin)}`);
  }
  const scope = message.conversation.kind;
  const trustRole = roles.isMaster ? 'master' : roles.isTrusted ? 'trusted' : 'user';
  const principalRoles = [...new Set([...(message.sender?.roles ?? []), trustRole])];
  return Object.freeze({
    ...(contextState ? { input: Object.freeze({ contextState }) } : {}),
    origin: Object.freeze({
      kind: 'im' as const,
      conversation: message.conversation,
      ...(message.conversation.threadId ? { threadId: message.conversation.threadId } : {}),
      platform,
      endpoint,
      scope,
      sceneId: resolveChannelId(message),
      ...(message.id ? { messageId: message.id } : {}),
    }),
    principal: Object.freeze({
      subjectId,
      ...(message.sender?.name ? { displayName: message.sender.name } : {}),
      roles: Object.freeze(principalRoles),
      ...(messageOrigin ? { origin: messageOrigin } : {}),
    }),
    policy: Object.freeze({
      permissions: Object.freeze(principalRoles),
      unattended: false,
    }),
  });
}

export function runtimeImSessionKey(access: TurnAccessContext): string {
  const origin = access.origin;
  if (origin.kind !== 'im') throw new TypeError('Runtime IM access requires an IM origin');
  return `${origin.platform}:${origin.endpoint}:${origin.scope}:${origin.sceneId}`;
}

export function resolveOwnerForRuntimeMessage(
  message: Message,
  resolve?: EndpointOwnerResolver,
): string | undefined {
  if (!resolve) return undefined;
  const localName = capabilityLocalName(String(message.conversation.endpoint.id));
  const endpointKey = String(
    message.metadata?.endpoint
    ?? message.metadata?.endpointKey
    ?? localName,
  );
  return resolve(localName, endpointKey) ?? resolve(endpointKey, endpointKey);
}

export function resolveTrustedForRuntimeMessage(
  message: Message,
  resolve?: EndpointTrustedResolver,
): readonly string[] {
  if (!resolve) return [];
  const localName = capabilityLocalName(String(message.conversation.endpoint.id));
  const endpointKey = String(
    message.metadata?.endpoint
    ?? message.metadata?.endpointKey
    ?? localName,
  );
  const merged = [...resolve(localName, endpointKey), ...resolve(endpointKey, endpointKey)];
  return [...new Set(merged.map((id) => String(id).trim()).filter(Boolean))];
}

function resolveChannelId(message: Message): string {
  const id = message.conversation.id.trim();
  if (!id) throw new TypeError('Runtime IM ingress requires scene identity');
  return id;
}

export function capabilityLocalName(id: string): string {
  const parts = id.split('\0');
  const local = parts.length >= 3 ? parts[2]! : id;
  // 展开 id 形如 `slot~entry`（多 endpoint）：adapter 名取 slot localName
  return local.split('~')[0]!;
}

/** Endpoint liveName (e.g. ICQQ uin, sandbox bot name) from the typed endpoint identity. */
export function adapterLiveEndpointId(message: Message): string {
  if (message.endpointId) return message.endpointId;
  return capabilityLocalName(String(message.conversation.endpoint.id));
}

export function runtimeApprovalPolicy(
  requiresApproval: ToolCapability['requiresApproval'],
): ToolCapability['requiresApproval'] {
  return requiresApproval;
}

/** A small non-interactive ApprovalPort suitable for CLI/service hosts and tests. */
export function createDeterministicApprovalPort(
  decision: 'approve' | 'deny' = 'deny',
): ApprovalOutcomePort {
  const port: ApprovalOutcomePort = {
    available: true,
    requestApprovalOutcome: async input => input.humanOnly
      ? { status: 'unavailable', reason: 'this non-interactive host cannot obtain fresh human approval' }
      : decision === 'approve' ? { status: 'approved', decision: 'approve-once' } : { status: 'denied', by: 'user' },
    requestApproval: async input => (await port.requestApprovalOutcome(input)).status === 'approved',
  };
  return port;
}
