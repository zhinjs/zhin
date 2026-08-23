import {
  Client,
  parseGroupMessageId,
  type Config as NativeIcqqClientConfig,
  type FileElem,
  type PttElem,
  type Sendable,
  type VideoElem,
} from '@icqqjs/icqq';
import { inspect } from 'node:util';
import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  EndpointControl,
  EndpointInstance,
  EndpointManagement,
  EndpointPendingRequest,
  EndpointSendRequest,
} from 'zhin.js/adapter';
import type { EndpointContentPort, EndpointContentResolveContext } from '@zhin.js/adapter';
import type { MessageGateway, SideEventGateway } from '@zhin.js/core/runtime';
import { receiveOneBotLikeSideEvent, SystemEvent, toCanonicalSegments, type LoginAssist } from '@zhin.js/core';
import type {
  ConversationMessage,
  ConversationReference,
  ForwardEntry,
  MessageRef,
  Segment,
} from '@zhin.js/im-contract';
import { formatCompact, getAdapterLogger, truncatePreview } from '@zhin.js/logger';
import type { CapabilityId } from 'zhin.js';
import { registerIcqqAgentEndpoint } from './icqq-agent-deps.js';
import { runIcqqLoginAssistStep } from './icqq-login-assist.js';
import {
  InboundMessageDeduper,
  findIcqqNestedMessageSource,
  isIcqqBotMentioned,
  isIcqqMessagePostType,
  normalizeIcqqInboundMessage,
  messageLookupFromIcqqSource,
  resolveIcqqQuoteIdFromEvent,
  resolveIcqqInboundMedia,
  shouldSkipSelfInboundMessage,
  type IcqqMessageEvent,
} from './icqq-inbound.js';
import {
  isIcqqNoticePayload,
  isIcqqRequestPayload,
} from './icqq-inbox.js';
import {
  IcqqGuildCatalog,
  normalizeIcqqGuildInboundMessage,
} from './icqq-guild.js';
import {
  prepareIcqqOutboundMedia,
  resolveIcqqOutboundMediaMode,
} from './outbound-media.js';
import {
  formatInboundContent,
  formatOutboundBody,
  icqqInboundConversation,
  icqqOutboundTarget,
  type IcqqInboundMessage,
  type ResolvedIcqqConfig,
} from './protocol.js';
import type { SystemMessage as IcqqSystemMessage } from './types.js';
import { normalizeForwardMsgResponse } from './forward-msg.js';

export interface IcqqEndpointOptions {
  readonly id: CapabilityId;
  readonly gateway: MessageGateway;
  readonly config: ResolvedIcqqConfig;
  readonly sideEvents: SideEventGateway;
  readonly loginAssist: LoginAssist;
}

const BOUND_EVENTS = [
  'message.private',
  'message.group',
  'message.guild',
  'request.friend',
  'request.group',
  'notice.friend',
  'notice.group',
  'system.online',
  'system.offline',
  'system.offline.network',
  'system.offline.kickoff',
  'system.login.qrcode',
  'system.login.device',
  'system.login.slider',
  'system.login.error',
  'system.login.auth',
] as const;

export class IcqqEndpoint extends Client implements EndpointInstance {
  readonly #logger: ReturnType<typeof getAdapterLogger>;
  readonly #options: IcqqEndpointOptions;
  readonly endpointName: string;
  readonly #guildCatalog = new IcqqGuildCatalog();
  readonly #inboundDeduper = new InboundMessageDeduper();
  readonly #sideEventDeduper = new InboundMessageDeduper();
  readonly #loginAssistOwner = Object.freeze({});
  #open = false;
  #retiring = false;
  #started = false;
  #retirementEpoch = 0;
  #retirementArmed = false;
  #resolveStartOnline?: () => void;
  #heldInbound: IcqqInboundMessage[] = [];
  #unregisterAgent?: () => void;
  readonly #inflightInbound = new Set<Promise<void>>();
  readonly #inboundOwner = new AsyncLocalStorage<symbol>();
  readonly #messageContent = new Map<string, ConversationMessage>();

  readonly content: EndpointContentPort = Object.freeze({
    resolve: async (reference: ConversationReference, context: EndpointContentResolveContext) => {
      context.signal.throwIfAborted();
      if (reference.kind === 'message') {
        const cached = this.#messageContent.get(reference.message.id);
        return cached
          ? Object.freeze({ status: 'resolved' as const, reference, value: cached })
          : Object.freeze({ status: 'not_found' as const, code: 'icqq_message_not_observed' });
      }
      if (reference.kind === 'forward') {
        try {
          const entries = await this.#resolveForwardEntries(
            reference.forwardId,
            context,
            { remainingEntries: context.maxEntries, path: new Set<string>() },
            0,
          );
          if (entries.length === 0) return Object.freeze({ status: 'not_found' as const, code: 'icqq_forward_not_found' });
          return Object.freeze({ status: 'resolved' as const, reference, value: Object.freeze(entries) });
        } catch (error) {
          if (context.signal.aborted) throw error;
          return Object.freeze({
            status: 'failed' as const,
            code: 'icqq_forward_fetch_failed',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
      if (reference.media.kind === 'url' || reference.media.kind === 'base64' || reference.media.kind === 'path') {
        return Object.freeze({ status: 'resolved' as const, reference, value: reference.media });
      }
      return Object.freeze({ status: 'unsupported' as const, code: 'icqq_media_reference_unsupported' });
    },
  });

  async #resolveForwardEntries(
    forwardId: string,
    context: EndpointContentResolveContext,
    state: { remainingEntries: number; readonly path: Set<string> },
    depth: number,
  ): Promise<readonly ForwardEntry[]> {
    context.signal.throwIfAborted();
    if (state.remainingEntries <= 0 || state.path.has(forwardId)) return Object.freeze([]);
    state.path.add(forwardId);
    try {
      // ICQQ does not expose a cancellable getForwardMsg API. Keep the caller's
      // generation lease until the native operation actually settles, then honor
      // cancellation before publishing any resolved content.
      const raw = await this.getForwardMsg(forwardId);
      context.signal.throwIfAborted();
      const entries = normalizeForwardMsgResponse(raw).slice(0, state.remainingEntries);
      state.remainingEntries -= entries.length;
      const expanded: ForwardEntry[] = [];
      for (const entry of entries) {
        context.signal.throwIfAborted();
        const segments: Segment[] = [];
        for (const segment of entry.segments) {
          if (segment.type !== 'forward' || depth >= context.maxDepth) {
            segments.push(segment);
            continue;
          }
          const nestedId = String((segment.data as { forward_id?: unknown }).forward_id ?? '').trim();
          if (!nestedId || state.path.has(nestedId) || state.remainingEntries <= 0) {
            segments.push(segment);
            continue;
          }
          const nested = await this.#resolveForwardEntries(nestedId, context, state, depth + 1);
          segments.push(Object.freeze({
            ...segment,
            data: Object.freeze({ ...segment.data, ...(nested.length > 0 ? { entries: nested } : {}) }),
          }));
        }
        expanded.push(Object.freeze({ ...entry, segments: Object.freeze(segments) }));
      }
      return Object.freeze(expanded);
    } finally {
      state.path.delete(forwardId);
    }
  }

  readonly management: EndpointManagement = Object.freeze<EndpointManagement>({
    listFriends: async () =>
      Array.from(this.fl.values()).map((f) => ({
        user_id: f.user_id,
        nickname: f.nickname,
        remark: f.remark ?? '',
      })),
    listGroups: async () =>
      Array.from(this.gl.values()).map((g) => ({
        group_id: g.group_id,
        name: g.group_name,
      })),
    listChannels: async () => {
      await this.#guildCatalog.syncAll(this);
      return this.#guildCatalog.getGuildChannelList();
    },
    listGroupMembers: async (groupId) =>
      Array.from((await this.getGroupMemberList(Number(groupId))).values()),
    listRequests: () => this.#listPendingRequests(),
    approveRequest: (requestId, remark) => this.#approveRequest(requestId, remark),
    rejectRequest: (requestId, reason) => this.#rejectRequest(requestId, reason),
    kickGroupMember: async (groupId, userId) => {
      await this.setGroupKick(Number(groupId), Number(userId));
    },
    muteGroupMember: async (groupId, userId, duration) => {
      await this.setGroupBan(Number(groupId), Number(userId), duration);
    },
    setGroupAdmin: async (groupId, userId, enabled) => {
      await this.setGroupAdmin(Number(groupId), Number(userId), enabled);
    },
    deleteFriend: async (userId) => {
      await this.deleteFriend(Number(userId));
    },
  });

  readonly control: EndpointControl = Object.freeze({
    recall: async (message: MessageRef) => {
      if (!message.id || message.id.startsWith('outbound:')) return;
      await this.deleteMsg(message.id);
    },
    addReaction: async (message: MessageRef, emoji: string) => {
      const target = resolveIcqqGroupReactionTarget(message);
      if (!target) return null;
      try {
        // Do not await protocol ACK — packet timeout must not stall the AI reply.
        this.#ignoreReactionAck(
          'add',
          this.pickGroup(target.groupId).setReaction(target.seq, emoji),
        );
      } catch (error) {
        this.#logger.debug(formatCompact({
          op: 'reaction_add_failed',
          error: error instanceof Error ? error.message : String(error),
        }));
      }
      return emoji;
    },
    removeReaction: async (message: MessageRef, reactionId: string) => {
      const target = resolveIcqqGroupReactionTarget(message);
      if (!target) return;
      try {
        this.#ignoreReactionAck(
          'remove',
          this.pickGroup(target.groupId).delReaction(target.seq, reactionId),
        );
      } catch (error) {
        this.#logger.debug(formatCompact({
          op: 'reaction_remove_failed',
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    },
  });

  constructor(options: IcqqEndpointOptions) {
    const nativeConfig = resolveNativeClientConfig(options.config);
    super(Number(options.config.id), nativeConfig);
    this.#logger = getAdapterLogger('icqq', options.config.id);
    this.#options = options;
    this.endpointName = options.config.id;
  }

  #ignoreReactionAck(action: 'add' | 'remove', task: Promise<unknown> | unknown): void {
    void Promise.resolve(task).catch((error) => {
      this.#logger.debug(formatCompact({
        op: `reaction_${action}_failed`,
        error: error instanceof Error ? error.message : String(error),
      }));
    });
  }

  async start(signal: AbortSignal): Promise<void> {
    if (this.#started) return;
    signal.throwIfAborted();
    // Invalidate a guard left by a prior lifecycle epoch before admitting a
    // new login attempt on this endpoint instance.
    this.#retirementEpoch += 1;
    this.#retirementArmed = false;
    this.#retiring = false;
    this.off('system.online');
    this.#started = true;
    let resolveOnline!: () => void;
    const onlineReady = new Promise<void>((resolve) => {
      resolveOnline = resolve;
    });
    const onAbort = () => resolveOnline();
    this.#resolveStartOnline = resolveOnline;
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      this.#bindClientEvents();
      await raceAbort(Promise.resolve(this.login(this.#options.config.password)), signal);
      await onlineReady;
      signal.throwIfAborted();
      await this.#pullPendingSystemMessages(signal);
      signal.throwIfAborted();
      this.#unregisterAgent = registerIcqqAgentEndpoint(this.endpointName, this);
      this.#logger.info(
        `connected (direct) | friends: ${this.fl.size} | groups: ${this.gl.size}`,
      );
    } catch (error) {
      await this.stop();
      this.#logger.debug(`Failed to connect ICQQ client: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      throw error;
    } finally {
      signal.removeEventListener('abort', onAbort);
      if (this.#resolveStartOnline === resolveOnline) this.#resolveStartOnline = undefined;
    }
  }

  open(): void {
    if (this.#retirementArmed) {
      this.#retirementEpoch += 1;
      this.#retirementArmed = false;
      this.off('system.online');
      this.#bindSystemOnlineEvent();
    }
    this.#retiring = false;
    this.#open = true;
    const held = this.#heldInbound.splice(0);
    for (const msg of held) {
      void this.admit(msg).catch((error) => {
        this.#logInboundHandlerFailure('held', error);
      });
    }
  }

  async close(): Promise<void> {
    this.#assertExternalLifecycle('close');
    this.#armRetirementFence();
    await Promise.allSettled([...this.#inflightInbound]);
  }

  async stop(): Promise<void> {
    this.#assertExternalLifecycle('stop');
    this.#armRetirementFence();
    await Promise.allSettled([...this.#inflightInbound]);
    this.#resolveStartOnline?.();
    this.#options.loginAssist.cancelOwned(this.#loginAssistOwner, 'endpoint_stopped');
    this.#heldInbound.length = 0;
    this.#unregisterAgent?.();
    this.#unregisterAgent = undefined;
    for (const event of BOUND_EVENTS) {
      // The retirement guard owns this matcher until a late login handshake
      // has finished. start()/open() replace it with the normal listener.
      if (event !== 'system.online') this.off(event);
    }
    // `Client.logout()` sends an account-level unregister packet before it
    // closes this transport. During config HMR the replacement endpoint for
    // the same UIN is already online, so unregistering the retiring generation
    // also closes the replacement session. Endpoint ownership is transport
    // scoped: retire only this Client's TCP connection.
    try {
      this.terminate();
    } catch { /* ignore */ }
      this.#inboundDeduper.clear();
      this.#sideEventDeduper.clear();
    this.#guildCatalog.clear();
    this.#started = false;
    this.#logger.debug(formatCompact({ op: 'disconnect' }));
  }

  #armRetirementFence(): void {
    this.#retiring = true;
    this.#open = false;
    if (this.#retirementArmed) return;
    this.#retirementArmed = true;
    const retirementEpoch = ++this.#retirementEpoch;
    // ICQQ owns reconnect through this per-Client timer. Clear it before any
    // asynchronous drain so a queued callback cannot enter while close waits.
    if (this.login_timer) {
      clearTimeout(this.login_timer);
      this.login_timer = null;
    }
    // A login callback may already be inside the SDK handshake, which has no
    // abort API. Replace the normal online listener with an epoch-owned guard
    // before draining inbound work. Transport termination is account-local;
    // logout would also unregister an HMR replacement using the same UIN.
    this.off('system.online');
    this.on('system.online', () => {
      if (this.#retirementEpoch !== retirementEpoch || !this.#retiring) return;
      try {
        this.terminate();
      } catch { /* already closed */ }
    });
  }

  async send({ conversation, payload }: EndpointSendRequest): Promise<string> {
    if (!this.#started) throw new Error('icqq endpoint 未连接');
    const mediaMode = resolveIcqqOutboundMediaMode(this.#options.config);
    const prepared = isIcqqSegmentPayload(payload)
      ? prepareIcqqOutboundMedia(payload, mediaMode)
      : { content: payload, dispose() {} };
    try {
      const message = formatOutboundBody(prepared.content);
      const preview = formatIcqqSendablePreview(message);
      const parsed = icqqOutboundTarget(conversation);
      let result: { message_id?: unknown };
      try {
        result = await this.#sendNative(parsed, message);
      } catch (error) {
        this.#logger.warn(formatCompact({
          op: 'icqq_send_failed',
          target: `${conversation.kind}:${conversation.id}`,
          error: describeUnknownError(error),
          preview: truncatePreview(preview, 120),
        }));
        throw error;
      }
      const messageId = String(result?.message_id ?? `sent_${Date.now()}`);
      this.#logger.info(
        `send ${conversation.kind}:${conversation.id} | id: ${messageId} | ${truncatePreview(preview, 80)}`,
      );
      return messageId;
    } finally {
      prepared.dispose();
    }
  }

  async #sendNative(
    target: ReturnType<typeof icqqOutboundTarget>,
    message: Sendable,
  ): Promise<{ message_id?: unknown }> {
    if (isIcqqFileElement(message)) {
      switch (target.kind) {
        case 'private': {
          const id = await this.pickFriend(target.userId).sendFile(message.file, message.name);
          return { message_id: id };
        }
        case 'group': {
          const stat = await this.pickGroup(target.groupId).sendFile(message.file, '/', message.name);
          return { message_id: stat.fid };
        }
        case 'temp':
        case 'channel':
          throw new TypeError(`ICQQ ${target.kind} conversation does not support file delivery`);
      }
    }
    switch (target.kind) {
      case 'private':
        return this.sendPrivateMsg(target.userId, message);
      case 'group':
        return this.sendGroupMsg(target.groupId, message);
      case 'temp':
        return this.sendTempMsg(target.groupId, target.userId, message);
      case 'channel':
        return this.sendGuildMsg(target.guildId, target.channelId, message) as unknown as { message_id?: unknown };
    }
  }

  admit(msg: IcqqInboundMessage): Promise<void> {
    return this.#trackInbound(() => this.#deliverInbound(msg));
  }

  #trackInbound(run: () => Promise<void>): Promise<void> {
    const owner = Symbol('icqq-inbound');
    let settle!: () => void;
    const settlement = new Promise<void>((resolve) => { settle = resolve; });
    this.#inflightInbound.add(settlement);
    let operation: Promise<void>;
    try {
      operation = this.#inboundOwner.run(owner, run);
    } catch (error) {
      this.#inflightInbound.delete(settlement);
      settle();
      return Promise.reject(error);
    }
    return operation.finally(() => {
      this.#inflightInbound.delete(settlement);
      settle();
    });
  }

  #assertExternalLifecycle(operation: 'close' | 'stop'): void {
    if (!this.#inboundOwner.getStore()) return;
    throw new Error(
      `ICQQ endpoint ${operation} cannot run inside its own inbound receive; invoke it from the owning lifecycle`,
    );
  }

  async #deliverInbound(msg: IcqqInboundMessage, admittedBeforeRetire = false): Promise<void> {
    const conversation = msg.conversation;
    if (!this.#open && !admittedBeforeRetire) {
      if (this.#retiring) return;
      if (this.#heldInbound.length >= INBOUND_HOLD_LIMIT) {
        const dropped = this.#heldInbound.shift();
        this.#logger.warn(formatCompact({
          op: 'icqq_inbound_hold_drop',
          endpoint: this.endpointName,
          id: dropped?.id,
          target: dropped
            ? `${dropped.conversation.kind}:${dropped.conversation.id}`
            : undefined,
          limit: INBOUND_HOLD_LIMIT,
        }));
      }
      this.#heldInbound.push(msg);
      this.#logger.info(
        `hold ${conversation.kind}:${conversation.id}`
        + (msg.sender ? ` from ${msg.sender.name ?? msg.sender.id}` : '')
        + ` until open | ${truncatePreview(msg.content, 80)}`,
      );
      return;
    }
    const mentioned = isIcqqBotMentioned({
      uin: this.endpointName,
      content: msg.segments,
      rawMessage: msg.content,
    });
    this.#logger.info(
      `recv ${conversation.kind}:${conversation.id}`
      + (msg.sender ? ` from ${msg.sender.name ?? msg.sender.id}` : '')
      + (mentioned ? ' (mentioned)' : '')
      + ` | ${truncatePreview(msg.content, 80)}`,
    );
    await this.#options.gateway.receive({
      conversation,
      message: { conversation, id: msg.id },
      content: msg.content,
      ...(msg.segments ? { segments: msg.segments } : {}),
      sender: msg.sender,
      endpointId: this.endpointName,
      ...(mentioned ? { mentioned: true } : {}),
      ...(msg.replyTo ? { replyTo: msg.replyTo } : {}),
      metadata: Object.freeze({
        channelType: msg.channelType,
        ...(msg.metadata ?? {}),
      }),
    }).catch((err) => {
      this.#logger.warn(formatCompact({
        op: 'recv',
        endpoint: this.endpointName,
        target: `${conversation.kind}:${conversation.id}`,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  #bindClientEvents(): void {
    const safe = (label: string, fn: () => void): void => {
      try {
        fn();
      } catch (error) {
        this.#logger.warn(formatCompact({
          op: 'icqq_event_handler',
          endpoint: this.endpointName,
          event: label,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    };
    this.on('message.private', (event) => this.#startMessageEvent('message.private', event));
    this.on('message.group', (event) => this.#startMessageEvent('message.group', event));
    this.on('message.guild', (event) => {
      void this.#handleGuildEvent(event).catch((error) => {
        this.#logInboundHandlerFailure('message.guild', error);
      });
    });
    this.on('request.friend', (event) => safe('request.friend', () => this.#onRequestEvent(serializeIcqqEvent(event))));
    this.on('request.group', (event) => safe('request.group', () => this.#onRequestEvent(serializeIcqqEvent(event))));
    this.on('notice.friend', (event) => safe('notice.friend', () => this.#onNoticeEvent(serializeIcqqEvent(event))));
    this.on('notice.group', (event) => safe('notice.group', () => this.#onNoticeEvent(serializeIcqqEvent(event))));
    this.#bindSystemOnlineEvent();
    this.on('system.offline', (event) => this.#logSystemEvent('offline', event));
    this.on('system.offline.network', (event) => this.#logSystemEvent('offline.network', event));
    this.on('system.offline.kickoff', (event) => this.#logSystemEvent('offline.kickoff', event));
    this.on('system.login.qrcode', (event) => {
      this.#logger.info('icqq 收到二维码登录事件，等待 LoginAssist / 终端确认后继续');
      this.#handleLoginChallenge('qrcode', event);
    });
    this.on('system.login.device', (event) => this.#handleLoginChallenge('device', event));
    this.on('system.login.slider', (event) => this.#handleLoginChallenge('slider', event));
    this.on('system.login.error', (event) => {
      this.#options.loginAssist.cancelOwned(this.#loginAssistOwner, 'login_error');
      this.#logSystemEvent('login.error', event);
    });
    this.on('system.login.auth', (event) => this.#handleLoginChallenge('auth', event));
  }

  #bindSystemOnlineEvent(): void {
    this.on('system.online', (event) => {
      if (this.#retiring) return;
      try {
        this.#resolveStartOnline?.();
        this.#options.loginAssist.cancelOwned(this.#loginAssistOwner, 'online');
        this.#logSystemEvent('online', event);
      } catch (error) {
        this.#logger.warn(formatCompact({
          op: 'icqq_event_handler',
          endpoint: this.endpointName,
          event: 'system.online',
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    });
  }

  #handleLoginChallenge(
    step: 'qrcode' | 'slider' | 'device' | 'auth',
    event: unknown,
  ): void {
    const payload = serializeIcqqEvent(event) ?? (event && typeof event === 'object'
      ? event as Record<string, unknown>
      : null);
    this.#logSystemEvent(`login.${step}`, event);
    void runIcqqLoginAssistStep({
      assist: this.#options.loginAssist,
      client: this,
      adapter: 'icqq',
      endpointKey: this.endpointName,
      owner: this.#loginAssistOwner,
      logger: this.#logger,
      step,
      event: payload ?? event,
    });
  }

  #logSystemEvent(type: string, event: unknown): void {
    const payload = serializeIcqqEvent(event);
    this.#logger.warn(formatCompact({
      op: `system.${type}`,
      endpoint: this.endpointName,
      ...(payload ? { event: JSON.stringify(payload) } : {}),
    }));
    this.#dispatchIcqqSystemSideEvent(type, payload);
  }

  #dispatchIcqqSideEvent(payload: Record<string, unknown>): void {
    const sideEvents = this.#options.sideEvents;
    const postType = String(payload.post_type ?? '');
    const isRequest = postType === 'request' || postType.startsWith('request.');
    const flag = payload.flag != null ? String(payload.flag) : '';
    void receiveOneBotLikeSideEvent(sideEvents, {
      adapter: 'icqq',
      endpointKey: this.endpointName,
      platform: 'icqq',
      raw: payload,
      ...(isRequest ? {
        approve: (id, remark) => this.#approveRequest(flag || id, remark),
        reject: (id, reason) => this.#rejectRequest(flag || id, reason),
      } : {}),
    }).catch((err) => {
      this.#logger.warn(formatCompact({
        op: 'icqq_side_event_failed',
        endpoint: this.endpointName,
        post_type: postType || undefined,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  #dispatchIcqqSystemSideEvent(type: string, payload: Record<string, unknown> | null): void {
    const sideEvents = this.#options.sideEvents;
    const { scene_type, sub_type } = parseIcqqSystemScene(type);
    void sideEvents.receiveSystem(SystemEvent.from(payload ?? {}, {
      $id: `system:${this.endpointName}:${type}:${Date.now()}`,
      $adapter: 'icqq' as never,
      $endpoint: this.endpointName,
      $type: 'system',
      $scene_id: this.endpointName,
      $scene_type: scene_type,
      $sub_type: sub_type,
      $timestamp: Date.now(),
    })).catch((err) => {
      this.#logger.warn(formatCompact({
        op: 'icqq_system_side_event_failed',
        endpoint: this.endpointName,
        type,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  async #handleMessageEvent(eventName: 'message.private' | 'message.group', event: unknown): Promise<void> {
    if (this.#retiring) return;
    const admittedBeforeRetire = this.#open;
    const payload = serializeIcqqEvent(event);
    if (!payload || !isIcqqMessagePostType(payload)) {
      this.#logger.debug(formatCompact({
        op: 'icqq_inbound_skip',
        reason: payload ? 'not_message_post' : 'serialize_failed',
        endpoint: this.endpointName,
        event: eventName,
      }));
      return;
    }
    const data = payload as IcqqMessageEvent;
    if (shouldSkipSelfInboundMessage(data)) {
      this.#logger.debug(formatCompact({
        op: 'icqq_inbound_skip',
        reason: 'self',
        endpoint: this.endpointName,
        user_id: data.user_id,
        self_id: data.self_id,
      }));
      return;
    }
    const contact = this.#resolveInboundContact(data);
    if (contact) {
      await resolveIcqqInboundMedia(data.message, {
        getPttUrl: (element) => contact.getPttUrl(element as PttElem),
        getVideoUrl: (element) => contact.getVideoUrl(element as VideoElem),
      });
      if (!this.#started) return;
    }
    const normalized = normalizeIcqqInboundMessage(data);
    if (!normalized) {
      this.#logger.debug(formatCompact({
        op: 'icqq_inbound_skip',
        reason: 'normalize_failed',
        endpoint: this.endpointName,
        event: eventName,
        message_id: data.message_id,
      }));
      return;
    }
    if (!this.#inboundDeduper.shouldProcess(normalized.messageId)) {
      this.#logger.debug(formatCompact({
        op: 'icqq_inbound_skip',
        reason: 'dedupe',
        endpoint: this.endpointName,
        id: normalized.messageId,
      }));
      return;
    }
    const conversation = icqqInboundConversation(String(this.#options.id), {
      channelType: normalized.channelType,
      channelId: normalized.channelId,
      channelParentGroupId: normalized.channelParentGroupId,
    });
    const quoteId = resolveIcqqQuoteIdFromEvent(data);
    const quoted = messageLookupFromIcqqSource(findIcqqNestedMessageSource(data));
    if (quoteId && quoted) {
      this.#messageContent.set(quoteId, Object.freeze({
        ref: Object.freeze({ conversation, id: quoteId }),
        ...(quoted.sender?.id ? { actor: Object.freeze({
          id: quoted.sender.id,
          ...(quoted.sender.name ? { displayName: quoted.sender.name } : {}),
        }) } : {}),
        segments: Object.freeze(toCanonicalSegments(
          Array.isArray(quoted.content)
            ? quoted.content
            : [{ type: 'text', data: { text: quoted.content } }],
        )),
        timestamp: quoted.time ? quoted.time * (quoted.time < 1e12 ? 1000 : 1) : Date.now(),
      }));
    }
    await this.#deliverInbound({
      id: normalized.messageId,
      conversation,
      content: formatInboundContent(normalized.rawMessage),
      segments: normalized.content,
      sender: {
        id: normalized.userId,
        name: normalized.nickname || undefined,
        ...(normalized.senderRole ? { roles: [normalized.senderRole] } : {}),
      },
      channelType: normalized.channelType,
      ...(quoteId ? { replyTo: { id: quoteId } } : {}),
      metadata: {
        nickname: normalized.nickname,
        senderRole: normalized.senderRole,
      },
    }, admittedBeforeRetire);
  }

  #startMessageEvent(eventName: 'message.private' | 'message.group', event: unknown): void {
    const operation = this.#trackInbound(() => this.#handleMessageEvent(eventName, event));
    void operation.catch((error) => {
      this.#logInboundHandlerFailure(eventName, error);
    });
  }

  #resolveInboundContact(data: IcqqMessageEvent) {
    const userId = Number(data.user_id ?? data.from_id);
    if (!Number.isFinite(userId) || userId <= 0) return null;
    if (data.message_type === 'group' || data.group_id != null) {
      const groupId = Number(data.group_id);
      return Number.isFinite(groupId) && groupId > 0 ? this.pickGroup(groupId) : null;
    }
    const sourceGroupId = Number(data.sender?.group_id);
    if (Number.isFinite(sourceGroupId) && sourceGroupId > 0) {
      return this.pickMember(sourceGroupId, userId);
    }
    return this.pickFriend(userId);
  }

  #logInboundHandlerFailure(event: string, error: unknown): void {
    this.#logger.warn(formatCompact({
      op: 'icqq_inbound_handler_failed',
      endpoint: this.endpointName,
      event,
      error: describeUnknownError(error),
    }));
  }

  async #handleGuildEvent(event: unknown): Promise<void> {
    const payload = serializeIcqqEvent(event);
    if (!payload || typeof payload !== 'object') return;
    const normalized = normalizeIcqqGuildInboundMessage(
      payload as Parameters<typeof normalizeIcqqGuildInboundMessage>[0],
    );
    if (!normalized) {
      this.#logger.debug(formatCompact({
        op: 'icqq_inbound_skip',
        reason: 'guild_normalize_failed',
        endpoint: this.endpointName,
      }));
      return;
    }
    this.#guildCatalog.upsertFromInbound(normalized.raw);
    if (!this.#inboundDeduper.shouldProcess(`guild:${normalized.messageId}`)) {
      this.#logger.debug(formatCompact({
        op: 'icqq_inbound_skip',
        reason: 'dedupe',
        endpoint: this.endpointName,
        id: `guild:${normalized.messageId}`,
      }));
      return;
    }
    await this.admit({
      id: normalized.messageId,
      conversation: icqqInboundConversation(String(this.#options.id), {
        channelType: 'channel',
        channelId: normalized.channelId,
        guildId: normalized.guildId,
      }),
      content: formatInboundContent(normalized.rawMessage),
      segments: normalized.content,
      sender: { id: normalized.userId, name: normalized.nickname || undefined },
      channelType: 'channel',
      metadata: {
        guildId: normalized.guildId,
        nickname: normalized.nickname,
      },
    });
  }

  #onRequestEvent(payload: Record<string, unknown> | null): void {
    if (!payload || !isIcqqRequestPayload(payload)) return;
    const flag = payload.flag != null ? String(payload.flag) : (payload.seq != null ? String(payload.seq) : '');
    if (flag && !this.#sideEventDeduper.shouldProcess(`request:${flag}`)) return;
    this.#dispatchIcqqSideEvent(payload);
  }

  #onNoticeEvent(payload: Record<string, unknown> | null): void {
    if (!payload || !isIcqqNoticePayload(payload)) return;
    const key = [
      payload.time,
      payload.operator_id ?? payload.user_id,
      payload.notice_type ?? payload.type,
      payload.sub_type,
    ].join('_');
    if (!this.#sideEventDeduper.shouldProcess(`notice:${key}`)) return;
    this.#dispatchIcqqSideEvent(payload);
  }

  async #listPendingRequests(): Promise<readonly EndpointPendingRequest[]> {
    const messages = await this.getSystemMsg();
    const rows: EndpointPendingRequest[] = [];
    for (const raw of messages) {
      const msg = raw as unknown as IcqqSystemMessage & { request_type?: string };
      const kind = msg.request_type === 'friend' ? 'friend' : 'group';
      const platformRequestId = (msg.flag && String(msg.flag).trim())
        || (msg.seq != null ? String(msg.seq) : '');
      if (!platformRequestId || msg.user_id == null) continue;
      const createdAt = Number(msg.time);
      rows.push(Object.freeze({
        platform_request_id: platformRequestId,
        type: kind,
        scene_type: kind === 'group' ? 'group' : null,
        scene_id: String(kind === 'group' ? (msg.group_id ?? msg.user_id) : msg.user_id),
        sub_type: kind === 'group' ? (msg.type != null ? String(msg.type) : null) : null,
        actor_id: String(msg.user_id),
        actor_name: msg.nickname != null ? String(msg.nickname) : null,
        comment: msg.comment != null ? String(msg.comment) : null,
        created_at: Number.isFinite(createdAt) && createdAt > 0
          ? (createdAt < 1e12 ? createdAt * 1000 : createdAt)
          : Date.now(),
      }));
    }
    return Object.freeze(rows);
  }

  async #pullPendingSystemMessages(signal: AbortSignal): Promise<void> {
    try {
      const messages = await raceAbort(Promise.resolve(this.getSystemMsg()), signal);
      for (const raw of messages) {
        signal.throwIfAborted();
        const msg = raw as unknown as IcqqSystemMessage & { request_type?: string };
        const kind = msg.request_type === 'friend' ? 'friend' : 'group';
        const flag = msg.flag != null ? String(msg.flag) : (msg.seq != null ? String(msg.seq) : '');
        if (!flag || !this.#sideEventDeduper.shouldProcess(`request:${flag}`)) continue;
        this.#dispatchIcqqSideEvent({
          post_type: 'request',
          request_type: kind,
          flag: msg.flag,
          user_id: msg.user_id,
          group_id: msg.group_id,
          comment: msg.comment,
          time: msg.time,
          sub_type: msg.type,
        });
      }
    } catch (error) {
      if (signal.aborted) throw signal.reason ?? error;
      this.#logger.debug(formatCompact({
        op: 'side_event_pull_system_msg',
        endpoint: this.endpointName,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  async #approveRequest(id: string, remark?: string): Promise<void> {
    const messages = await this.getSystemMsg();
    const target = messages.find((m) => {
      const msg = m as unknown as IcqqSystemMessage;
      return msg.flag === id || (msg.seq != null && String(msg.seq) === id);
    }) as unknown as IcqqSystemMessage | undefined;
    if (!target?.flag) {
      throw new Error(`icqq 未找到待处理请求: ${id}`);
    }
    if ((target as { request_type?: string }).request_type === 'friend') {
      await this.setFriendAddRequest(target.flag, true, remark);
    } else {
      await this.setGroupAddRequest(target.flag, true);
    }
  }

  async #rejectRequest(id: string, reason?: string): Promise<void> {
    const messages = await this.getSystemMsg();
    const target = messages.find((m) => {
      const msg = m as unknown as IcqqSystemMessage;
      return msg.flag === id || (msg.seq != null && String(msg.seq) === id);
    }) as unknown as IcqqSystemMessage | undefined;
    if (!target?.flag) {
      throw new Error(`icqq 未找到待处理请求: ${id}`);
    }
    if ((target as { request_type?: string }).request_type === 'friend') {
      await this.setFriendAddRequest(target.flag, false);
    } else {
      await this.setGroupAddRequest(target.flag, false, reason);
    }
  }
}

function formatIcqqSendablePreview(message: Sendable): string {
  if (typeof message === 'string') return message;
  try {
    return JSON.stringify(message, (_key, value) => Buffer.isBuffer(value) ? '<buffer>' : value);
  } catch {
    return '[ICQQ Sendable]';
  }
}

function isIcqqSegmentPayload(payload: unknown): payload is import('zhin.js').SendContent {
  if (Array.isArray(payload)) return true;
  return typeof payload === 'object'
    && payload !== null
    && typeof (payload as { type?: unknown }).type === 'string';
}

function isIcqqFileElement(message: Sendable): message is FileElem {
  return !Array.isArray(message)
    && typeof message !== 'string'
    && message.type === 'file';
}

async function raceAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let rejectAbort!: (reason: unknown) => void;
  const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(signal.reason ?? new Error('ICQQ operation aborted'));
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

function describeUnknownError(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  if (error && typeof error === 'object') {
    try {
      return JSON.stringify(error);
    } catch {
      return inspect(error, { depth: 4, breakLength: 120 });
    }
  }
  return String(error);
}

function resolveIcqqGroupReactionTarget(
  message: MessageRef,
): { groupId: number; seq: number } | null {
  if (message.conversation.kind !== 'group') return null;
  const groupId = Number(message.conversation.id);
  if (!Number.isFinite(groupId) || groupId <= 0) return null;
  const raw = message.id?.trim();
  if (!raw || raw.startsWith('outbound:')) return null;
  if (/^[1-9]\d*$/.test(raw)) return { groupId, seq: Number(raw) };
  try {
    const parsed = parseGroupMessageId(raw);
    if (parsed.seq > 0) return { groupId: parsed.group_id || groupId, seq: parsed.seq };
  } catch {
    // not a cqhttp group message id
  }
  return null;
}

function resolveNativeClientConfig(config: ResolvedIcqqConfig): NativeIcqqClientConfig {
  return {
    log_level: 'info',
    platform: config.platform,
    ...(config.ver ? { ver: config.ver } : {}),
    ...(config.dataDir ? { data_dir: config.dataDir } : {}),
    ...(config.signApiAddr ? { sign_api_addr: config.signApiAddr } : {}),
    ...(config.ignoreSelf != null ? { ignore_self: config.ignoreSelf } : {}),
    ...(config.resend != null ? { resend: config.resend } : {}),
    ...(config.cacheGroupMember != null ? { cache_group_member: config.cacheGroupMember } : {}),
    ...(config.autoServer != null ? { auto_server: config.autoServer } : {}),
    ...(config.qqnt != null ? { QQNT: config.qqnt } : {}),
    ...(config.ntLogin != null ? { NTLogin: config.ntLogin } : {}),
    reconn_interval: config.autoReconnect ? 5 : 0,
  };
}

function serializeIcqqEvent(event: unknown): Record<string, unknown> | null {
  if (!event || typeof event !== 'object') return null;
  const nativeToJSON = (event as { toJSON?: (keys: string[]) => unknown }).toJSON;
  if (typeof nativeToJSON === 'function') {
    try {
      const json = nativeToJSON.call(event, [...ICQQ_SERIALIZE_SKIP]);
      if (json && typeof json === 'object' && !Array.isArray(json)) {
        return json as Record<string, unknown>;
      }
    } catch {
      /* JSON.stringify 也会无参调 toJSON，不能当回退 */
    }
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(event as Record<string, unknown>)) {
    if (typeof value === 'function' || (ICQQ_SERIALIZE_SKIP as readonly string[]).includes(key)) continue;
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function parseIcqqSystemScene(type: string): { scene_type: string; sub_type: string } {
  if (type.startsWith('login.')) {
    return { scene_type: 'login', sub_type: type.slice('login.'.length) || 'unknown' };
  }
  if (type.startsWith('offline.')) {
    return { scene_type: 'offline', sub_type: type.slice('offline.'.length) || 'unknown' };
  }
  if (type === 'online') {
    return { scene_type: 'online', sub_type: 'online' };
  }
  if (type === 'offline') {
    return { scene_type: 'offline', sub_type: 'offline' };
  }
  return { scene_type: 'system', sub_type: type };
}

const INBOUND_HOLD_LIMIT = 32;

const ICQQ_SERIALIZE_SKIP = ['group', 'member', 'friend', 'discuss', 'client'] as const;
