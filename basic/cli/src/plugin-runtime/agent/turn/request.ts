import {
  collectSegmentMedia,
  toCanonicalSegments,
  type AITriggerConfig,
} from '@zhin.js/core';
import type { ImRuntime, Message } from '@zhin.js/core/runtime';
import type { UserInteraction } from '@zhin.js/interaction';
import type {
  AIService,
  ApprovalPort,
  ApprovalRequestInput,
  DeliveryOutcome,
  TurnAccessContext,
  TurnIntent,
  TurnRequest,
  TurnRequestPorts,
} from '@zhin.js/agent';
import {
  turnIntentResolverToken,
  type ToolCapability,
  type TurnIntentResolver,
} from '@zhin.js/agent/runtime';
import type { PluginId, RuntimeSnapshot } from '@zhin.js/plugin-runtime';
import type { ConversationReference, ConversationResolution } from '@zhin.js/im-contract';

type EndpointOwnerResolver = (adapterLocalName: string, endpointKey: string) => string | undefined;
type EndpointTrustedResolver = (adapterLocalName: string, endpointKey: string) => readonly string[];

export interface RuntimeSenderRoles {
  readonly isMaster: boolean;
  readonly isTrusted: boolean;
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
  }>,
): TurnRequest {
  const access = createRuntimeTurnAccess(message, roles);
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
      ...(media.length > 0 ? { media: Object.freeze(media) } : {}),
      ...(turnReferences.length > 0 ? { references: Object.freeze(turnReferences) } : {}),
      metadata: Object.freeze({ ...message.metadata, ...input.trustedMetadata }),
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

/** IM ApprovalPort: master is already the authority; others wait via UserInteraction. */
export function createRuntimeApprovalPort(options: {
  readonly isMaster: boolean;
  readonly interaction?: UserInteraction;
  readonly rememberSession?: Readonly<{
    isApproved(input: ApprovalRequestInput): boolean;
    grant(input: ApprovalRequestInput): void;
  }>;
}): ApprovalPort {
  return Object.freeze({
    available: options.isMaster || options.interaction != null,
    async requestApproval(input: ApprovalRequestInput) {
      if (options.isMaster) return true;
      if (!options.interaction) return false;
      try {
        if (input.remember === 'session' && options.rememberSession?.isApproved(input)) return true;
        if (input.remember === 'session' && options.rememberSession) {
          const decision = await options.interaction.ask({
            type: 'select',
            title: '操作确认',
            description: input.question,
            tip: '“本会话允许”仅在当前 Host 生命周期内生效。',
            options: [
              { label: '允许一次', value: 'once', description: '仅执行当前操作。' },
              { label: '本会话允许', value: 'session', description: '后续同会话、同一具体操作自动放行。' },
              { label: '拒绝', value: 'deny', description: '阻止当前操作。' },
            ],
            default: 'deny',
            ...(input.timeoutMs !== undefined ? { timeout: input.timeoutMs } : {}),
            signal: input.signal,
          });
          if (decision === 'session') options.rememberSession.grant(input);
          return decision === 'once' || decision === 'session';
        }
        return await options.interaction.ask({
          type: 'confirm',
          title: '操作确认',
          description: input.question,
          tip: '请由 master 用户确认是否继续。',
          confirmLabel: '允许一次',
          cancelLabel: '拒绝',
          ...(input.timeoutMs !== undefined ? { timeout: input.timeoutMs } : {}),
          default: false,
          signal: input.signal,
        });
      } catch {
        return false;
      }
    },
  });
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
  return config?.execPreset === 'network'
    ? Object.freeze({ enabled: true, httpsOnly: true, allowedDomains: Object.freeze([]) })
    : undefined;
}

export function createRuntimeTurnAccess(
  message: Message,
  roles: RuntimeSenderRoles,
): TurnAccessContext {
  const platform = capabilityLocalName(String(message.conversation.endpoint.id));
  const endpoint = message.endpointId?.trim();
  if (!endpoint) throw new TypeError('Runtime IM ingress requires endpoint identity');
  const subjectId = message.sender?.id?.trim();
  if (!subjectId) throw new TypeError('Runtime IM ingress requires authenticated sender identity');
  const scope = message.conversation.kind;
  const trustRole = roles.isMaster ? 'master' : roles.isTrusted ? 'trusted' : 'user';
  const principalRoles = [...new Set([...(message.sender?.roles ?? []), trustRole])];
  return Object.freeze({
    origin: Object.freeze({
      kind: 'im' as const,
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
): 'never' | 'always' | 'once' | 'on-risk' {
  return requiresApproval;
}

/** A small non-interactive ApprovalPort suitable for CLI/service hosts and tests. */
export function createDeterministicApprovalPort(
  decision: 'approve' | 'deny' = 'deny',
): ApprovalPort {
  return {
    available: true,
    requestApproval: async () => decision === 'approve',
  };
}
