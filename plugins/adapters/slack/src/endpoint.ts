/**
 * SlackEndpoint — lifecycle, outbound, admit, Socket Mode, agent tool surface.
 */
import { WebClient, type WebClientOptions } from '@slack/web-api';
import { SocketModeClient } from '@slack/socket-mode';
import { createSlackWebApiAgent } from './web-api-proxy.js';
import { createSlackStreamAgent } from './stream-proxy.js';
import { slackSocketConnectionError } from './socket-error.js';
import { slackWebClientOptions, slackDeliveryError } from './web-client.js';
import {
  createEndpointSpecification,
  endpointSpec,
  type Endpoint,
  type EndpointSpecification,
  createEndpointLifecycle,
  type EndpointFriend,
  type EndpointGroup,
  type EndpointControl,
  type EndpointManagement,
  type EndpointSendRequest,
  type EndpointManagementRequest,
  createEndpointOperation,
  type EndpointGroupRequest,
} from 'zhin.js/adapter';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { formatCompact, getAdapterLogger } from '@zhin.js/logger';
import type { CapabilityId } from 'zhin.js';
import {
  formatInboundContent,
  formatInteractionContent,
  formatSlashContent,
  resolveSlackChannelType,
  slackInboundConversation,
  type ResolvedSlackConfig,
  type SlackEvent,
  type SlackEventEnvelope,
  type SlackInteractionPayload,
  type SlackMessageEvent,
  type SlackSlashCommand,
} from './protocol.js';
import {
  createSlackInboundFilterState,
  shouldDropSlackInboundMessage,
} from './slack-inbound-filter.js';
import { formatSlackMessageRef, parseSlackMessageRef } from './slack-message-ref.js';
import { normalizeSlackReactionName } from './slack-reaction.js';
import { postSlackEphemeral } from './slack-response-url.js';
import { editSlackContent, sendSlackContent, type SlackChatClient, type SlackEditRequest } from './slack-outbound.js';
import { registerSlackWebhookRoutes, type SlackWebhookHandler } from './webhook.js';
import { receiveSlackSideEvent } from './side-event-dispatch.js';

export interface SlackSocketLike {
  on(
    event: string,
    handler: (args: { ack: () => Promise<void>; body: unknown }) => void | Promise<void>,
  ): void;
  start(): Promise<void>;
  disconnect(): Promise<void>;
}

export type SlackWebClientLike = WebClient;

export interface SlackEndpointOptions {
  readonly id: CapabilityId;
  readonly config: ResolvedSlackConfig;
  readonly http?: HttpHost;
  readonly webApiAgent?: ReturnType<typeof createSlackWebApiAgent>;
  readonly webOptions?: WebClientOptions;
  readonly createSocket?: (opts: {
    readonly appToken: string;
    readonly clientPingTimeout: number;
    readonly autoReconnectEnabled: false;
  }) => SlackSocketLike;
}

export class SlackEndpoint extends WebClient implements Endpoint, SlackWebhookHandler {
  readonly [endpointSpec]: EndpointSpecification;
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: SlackEndpointOptions;
  readonly #inboundFilter = createSlackInboundFilterState();
  readonly #messageChannelMap = new Map<string, string>();
  #socket?: SlackSocketLike;
  readonly #lifecycle: ReturnType<typeof createEndpointLifecycle>;
  #routeReleases: HttpRouteRegistration[] = [];
  #botUserId?: string;
  #executionSignal?: AbortSignal;
  #started = false;
  readonly #management: EndpointManagement = createSlackEndpointManagement(() => this);
  readonly #control: EndpointControl = Object.freeze<EndpointControl>({
    recall: async ({ message, signal }) => {
      const ref = this.resolveMessageRef(message.id, message.conversation.id);
      if (!ref || !this.#started) return;
      await createEndpointOperation({ signal }).run(() => this.chat.delete(ref));
    },
    edit: async ({ message, content, signal }) => {
      const ref = this.resolveMessageRef(message.id, message.conversation.id);
      if (!ref) return null;
      await this.#editMessage({ channel: ref.channel, ts: ref.ts, content, signal });
      return message.id;
    },
    addReaction: async ({ message, emoji, signal }) => {
      const ref = this.resolveMessageRef(message.id, message.conversation.id);
      if (!ref) return null;
      const reaction = normalizeSlackReactionName(emoji);
      await this.#addReaction({ channel: ref.channel, timestamp: ref.ts, name: reaction, signal });
      return reaction;
    },
    removeReaction: async ({ message, reactionId, signal }) => {
      const ref = this.resolveMessageRef(message.id, message.conversation.id);
      if (!ref) return;
      await this.#removeReaction({ channel: ref.channel, timestamp: ref.ts, name: reactionId, signal });
    },
  });

  constructor(options: SlackEndpointOptions) {
    super(options.config.token, slackWebClientOptions({ ...options.webOptions, ...(options.webApiAgent ? { agent: options.webApiAgent } : {}) }));
    this.#logger = getAdapterLogger('slack', options.config.id);
    this.#options = options;
    this.#lifecycle = createEndpointLifecycle({ name: options.config.id });
    const endpoint = this;
    this[endpointSpec] = createEndpointSpecification(this, {
      start: signal => this.#startFramework(signal), open: () => undefined, close: () => undefined,
      stop: () => this.#stopFramework(), send: request => this.#sendFramework(request),
      name: options.config.id, get transportState() { return endpoint.#transportState; },
      management: this.#management, control: this.#control,
    });
  }

  /** Console 展示 / AdapterIndex live name（多 endpoint 时与 entry name 一致）。 */
  get name(): string {
    return this.#options.config.id;
  }

  get #transportState() { return this.config.mode === 'socket' ? this.#lifecycle.state : this.#started ? 'open' : 'stopped'; }

  get platformUserId(): string | undefined {
    return this.#botUserId;
  }

  get config(): ResolvedSlackConfig {
    return this.#options.config;
  }

  async #startFramework(signal: AbortSignal): Promise<void> {
    this.#executionSignal = signal;
    if (this.#started) return;
    this.#started = true;
    try {
      const { config } = this.#options;

      if (config.mode === 'socket') {
        await this.#startSocket();
      } else {
        const http = this.#options.http;
        if (!http) {
          throw new Error('Slack HTTP Events API requires httpHostToken (Runtime Host)');
        }
        this.#routeReleases.push(...registerSlackWebhookRoutes(http, this));
        this.#logger.debug(formatCompact({
          endpoint: config.id,
          op: 'webhook',
          path: config.webhookPath,
        }));
      }

      const authTest = await this.auth.test();
      if (authTest.user_id) this.#botUserId = String(authTest.user_id);

      this.#logger.info(
        `connected (${config.mode})`
        + (this.#botUserId ? ` | user: ${this.#botUserId}` : ''),
      );
    } catch (error) {
      await this.#stopFramework();
      this.#logger.error('Failed to connect Slack endpoint:', error);
      throw error;
    }
  }

  async #stopFramework(): Promise<void> {
    this.#options.webApiAgent?.destroy();
    await this.#lifecycle.stop();
    if (this.#socket) {
      try {
        await this.#socket.disconnect();
      } catch {
        /* ignore */
      }
      this.#socket = undefined;
    }
    for (const release of this.#routeReleases.splice(0)) release();
    this.#started = false;
    this.#logger.debug(formatCompact({ op: 'disconnect' }));
  }

  async #sendFramework({ conversation, payload, signal }: EndpointSendRequest): Promise<string> {
    if (!this.#started) throw new Error('Slack client not connected');
    const channel = conversation.id;
    const threadTs = conversation.threadId;
    try {
      const result = await sendSlackContent(this, { content: payload, channel, threadTs, logger: this.#logger, signal });
      this.trackMessageChannel(result.ts, channel);
      return formatSlackMessageRef(channel, result.ts);
    } catch (error) { throw slackDeliveryError(error); }
  }

  /** Test / internal: admit a message event when open. */
  admit(event: SlackMessageEvent | SlackEvent, original: unknown = event): void {
    void this[endpointSpec].events.run(() => {
      void this.#emitPlatformEvent(event.type || 'event', event);
      if (event.type !== 'message' && event.type !== 'app_mention') return;
      const msg = event as SlackMessageEvent;
      if (shouldDropSlackInboundMessage(msg, this.#inboundFilter, this.#botUserId)) return;
      if (!msg.channel || !msg.ts) return;

      this.trackMessageChannel(msg.ts, msg.channel);
      const threadTs = msg.thread_ts && msg.thread_ts !== msg.ts ? msg.thread_ts : undefined;
      const conversation = slackInboundConversation(String(this.#options.id), {
        channelId: msg.channel,
        channelType: msg.channel_type,
        threadId: threadTs,
      });
      void this[endpointSpec].events.emit('message.receive', {
        conversation,
        event: original,
        ...(typeof msg.ts === 'string' && Number.isFinite(Number(msg.ts)) ? { platformSentAt: Number(msg.ts) * 1_000 } : {}),
        message: { conversation, id: msg.ts },
        content: formatInboundContent(msg),
        sender: { id: msg.user ?? msg.channel ?? '' },
        endpointId: this.#options.config.id,
        ...(msg.type === 'app_mention' ? { mentioned: true } : {}),
        metadata: Object.freeze({
          channelType: resolveSlackChannelType(msg),
          userId: msg.user,
          threadTs,
          ts: msg.ts,
        }),
      }).catch((err) => {
        this.#logger.warn(formatCompact({
          op: 'slack_gateway_receive_failed',
          target: `${conversation.kind}:${conversation.id}`,
          error: err instanceof Error ? err.message : String(err),
        }));
      });
    }).catch(() => this.#logger.debug('Inbound callback did not complete'));
  }

  admitInteraction(payload: SlackInteractionPayload): void {
    void this[endpointSpec].events.run(() => {
      void this.#emitPlatformEvent(`interaction.${payload.type}`, payload);
      if (payload.type !== 'block_actions' || !payload.actions?.length) return;
      const channelId = payload.channel?.id ?? '';
      const userId = payload.user.id;
      const messageTs = payload.message?.ts ?? '';
      const sourceThread = payload.message?.thread_ts;
      const threadTs = typeof sourceThread === 'string' && sourceThread && sourceThread !== messageTs ? sourceThread : undefined;
      if (payload.response_url) {
        postSlackEphemeral(payload.response_url, '已收到', this.#logger);
      }
      const actionTs = payload.actions[0]?.action_ts ?? messageTs ?? `action-${Date.now()}`;
      const platformSentAt = Number(payload.actions[0]?.action_ts) * 1_000;
      const conversation = slackInboundConversation(String(this.#options.id), {
        channelId: channelId || userId,
        // block_actions 无 channel_type；无 channel 时按与发起用户的 DM 处理
        channelType: channelId ? undefined : 'im',
        threadId: threadTs,
      });
      void this[endpointSpec].events.emit('message.receive', {
        conversation,
        event: payload,
        ...(Number.isFinite(platformSentAt) ? { platformSentAt } : {}),
        message: { conversation, id: actionTs },
        content: formatInteractionContent(payload),
        segments: [{ type: 'action', data: { id: actionTs, payload: payload.actions[0].value ?? payload.actions[0].action_id, ...(messageTs ? { sourceMessageId: messageTs } : {}) } }],
        sender: { id: userId },
        endpointId: this.#options.config.id,
        metadata: Object.freeze({
          eventType: 'block_actions',
          actionId: payload.actions[0]?.action_id,
          threadTs,
        }),
      }).catch((err) => {
        this.#logger.warn(formatCompact({
          op: 'slack_gateway_receive_failed',
          target: `${conversation.kind}:${conversation.id}`,
          error: err instanceof Error ? err.message : String(err),
        }));
      });
    }).catch(() => this.#logger.debug('Inbound callback did not complete'));
  }

  admitSlashCommand(cmd: SlackSlashCommand): void {
    void this[endpointSpec].events.run(() => {
      void this.#emitPlatformEvent(`slash.${cmd.command}`, cmd);
      postSlackEphemeral(cmd.response_url, '处理中…', this.#logger);
      const conversation = slackInboundConversation(String(this.#options.id), {
        channelId: cmd.channel_id,
      });
      void this[endpointSpec].events.emit('message.receive', {
        conversation,
        message: { conversation, id: cmd.trigger_id },
        event: cmd,
        content: formatSlashContent(cmd),
        sender: { id: cmd.user_id, name: cmd.user_name },
        endpointId: this.#options.config.id,
        metadata: Object.freeze({
          eventType: 'slash_command',
          command: cmd.command,
        }),
      }).catch((err) => {
        this.#logger.warn(formatCompact({
          op: 'slack_gateway_receive_failed',
          target: `${conversation.kind}:${conversation.id}`,
          error: err instanceof Error ? err.message : String(err),
        }));
      });
    }).catch(() => this.#logger.debug('Inbound callback did not complete'));
  }

  handleEnvelope(body: unknown): void {
    void this[endpointSpec].events.run(() => {
      const envelope = body as SlackEventEnvelope;
      if (envelope?.type === 'event_callback' && envelope.event) {
        const event = envelope.event;
        if (event.type !== 'message' && event.type !== 'app_mention') {
          void this.#emitPlatformEvent(event.type || 'event', event);
          receiveSlackSideEvent(
            (name, payload) => this[endpointSpec].events.emit(name, payload),
            String(this.#options.id),
            this.#options.config.id,
            event,
            this.#logger,
          );
          return;
        }
        this.admit(event, body);
      }
    }).catch(() => this.#logger.debug('Inbound callback did not complete'));
  }

  trackMessageChannel(ts: string, channel: string): void {
    if (!ts || !channel) return;
    // LRU：超 1024 条淘汰最久未更新的记录，避免无界增长。
    if (this.#messageChannelMap.has(ts)) this.#messageChannelMap.delete(ts);
    this.#messageChannelMap.set(ts, channel);
    if (this.#messageChannelMap.size > 1024) {
      const oldest = this.#messageChannelMap.keys().next().value;
      if (oldest != null) this.#messageChannelMap.delete(oldest);
    }
  }

  resolveMessageRef(messageId: string, channelHint?: string): { channel: string; ts: string } | null {
    const parsed = parseSlackMessageRef(messageId);
    if (parsed) {
      this.trackMessageChannel(parsed.ts, parsed.channel);
      return parsed;
    }
    if (channelHint) return { channel: channelHint, ts: messageId };
    const channel = this.#messageChannelMap.get(messageId);
    return channel ? { channel, ts: messageId } : null;
  }

  async recallMessage(messageId: string): Promise<void> {
    if (!this.#started) return;
    const ref = this.resolveMessageRef(messageId);
    if (!ref) return;
    await this.chat.delete({ channel: ref.channel, ts: ref.ts });
  }

  async #editMessage(request: SlackEditRequest): Promise<void> {
    if (!this.#started) throw new Error('Slack client not connected');
    await editSlackContent(this, request);
  }

  async #addReaction({ channel, timestamp, name, signal }: SlackReactionRequest): Promise<void> {
    const reaction = normalizeSlackReactionName(name);
    try {
      await createEndpointOperation({ signal }).run(() => this.reactions.add({ channel, timestamp, name: reaction }));
    } catch (error) {
      const code = (error as { data?: { error?: string } })?.data?.error;
      if (code === 'already_reacted') return;
      throw error;
    }
  }

  async #removeReaction({ channel, timestamp, name, signal }: SlackReactionRequest): Promise<void> {
    const reaction = normalizeSlackReactionName(name);
    try {
      await createEndpointOperation({ signal }).run(() => this.reactions.remove({ channel, timestamp, name: reaction }));
    } catch (error) {
      const code = (error as { data?: { error?: string } })?.data?.error;
      if (code === 'no_reaction') return;
      throw error;
    }
  }

  async #emitPlatformEvent(name: string, event: unknown): Promise<void> {
    await this[endpointSpec].events.platform(name, event).catch((error) => {
      this.#logger.warn(formatCompact({
        op: 'slack_platform_event_failed',
        event: name,
        error: error instanceof Error ? error.message : String(error),
      }));
    });
  }

  #awaitSocketAck(ack: Promise<unknown>): Promise<unknown> {
    const signal = this.#executionSignal;
    if (!signal) return ack;
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      void ack.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
      if (signal.aborted) abort();
    });
  }

  async #startSocket(): Promise<void> {
    const { config } = this.#options;
    if (!config.appToken) {
      throw new Error('Slack Socket Mode 需要 appToken（xapp- 前缀的 App-Level Token）；注意 bot token 填 token 字段（xoxb- 前缀），两者不可混用');
    }
    if (!config.appToken.startsWith('xapp-')) {
      throw new Error(`Slack appToken 格式不正确：Socket Mode 需要 xapp- 前缀的 App-Level Token（当前看起来是 ${config.appToken.slice(0, 5)}…，xoxb- 是 bot token，请填到 token 字段）`);
    }
    await this.#lifecycle.start(async handle => {
      let active = true;
      let connectionError: Error | undefined;
      const agent = config.streamProxy ? createSlackStreamAgent(config.streamProxy) : undefined;
      const socket = this.#options.createSocket?.({ appToken: config.appToken!, clientPingTimeout: config.clientPingTimeout, autoReconnectEnabled: false })
        ?? new SocketModeClient({ appToken: config.appToken!, clientPingTimeout: config.clientPingTimeout,
          autoReconnectEnabled: false, ...(agent ? { clientOptions: { agent } } : {}) }) as unknown as SlackSocketLike;
      this.#socket = socket;
      const release = () => { if (!active) return; active = false; if (this.#socket === socket) this.#socket = undefined; agent?.destroy(); void socket.disconnect().catch(() => {}); };
      handle.onForceClose(release);
      socket.on('disconnected', () => { if (!active) return; release(); handle.notifyClosed('Slack socket disconnected'); });
      socket.on('error', error => { connectionError = slackSocketConnectionError(error); if (!active) return; release(); handle.notifyClosed('Slack socket error'); });
      socket.on('slack_event', ({ ack, body }) => {
        if (!active || this.#socket !== socket) return;
        void this[endpointSpec].events.run(async () => {
          try { await this.#awaitSocketAck(ack()); } catch (error) {
            if (!this.#executionSignal?.aborted) this.#logger.warn(formatCompact({ op: 'slack_socket_ack_failed' }));
            throw error;
          }
          this.#executionSignal?.throwIfAborted();
          if (active) this.handleEnvelope(body);
        }).catch(() => this.#logger.debug('Socket callback did not complete'));
      });
      socket.on('interactive', ({ ack, body }) => {
        if (!active || this.#socket !== socket) return;
        void this[endpointSpec].events.run(async () => {
          try { await this.#awaitSocketAck(ack()); } catch (error) {
            if (!this.#executionSignal?.aborted) this.#logger.warn(formatCompact({ op: 'slack_socket_ack_failed' }));
            throw error;
          }
          this.#executionSignal?.throwIfAborted();
          if (active) this.admitInteraction(body as SlackInteractionPayload);
        }).catch(() => this.#logger.debug('Socket callback did not complete'));
      });
      socket.on('slash_commands', ({ ack, body }) => {
        if (!active || this.#socket !== socket) return;
        void this[endpointSpec].events.run(async () => {
          try { await this.#awaitSocketAck(ack()); } catch (error) {
            if (!this.#executionSignal?.aborted) this.#logger.warn(formatCompact({ op: 'slack_socket_ack_failed' }));
            throw error;
          }
          this.#executionSignal?.throwIfAborted();
          if (active) this.admitSlashCommand(body as SlackSlashCommand);
        }).catch(() => this.#logger.debug('Socket callback did not complete'));
      });
      try { await socket.start(); } catch (error) { release(); throw connectionError ?? slackSocketConnectionError(error); }
    });
  }
}

/** Slack Web API 分页上限（每页 1000，cursor 翻页直到 next_cursor 为空）。 */
const SLACK_LIST_PAGE_SIZE = 1000;

function createSlackEndpointManagement(
  requireClient: () => SlackWebClientLike,
): EndpointManagement {
  return Object.freeze<EndpointManagement>({
    // Slack 无"群"概念：public channel 归一为 group（channel 语义由 listChannels 之外省略，
    // Slack channel 本身就是会话载体，避免同一批数据在两个列表里重复）。
    async listGroups(request: EndpointManagementRequest = {}): Promise<readonly EndpointGroup[]> {
      const operation = createEndpointOperation(request);
      const client = requireClient();
      const groups: EndpointGroup[] = [];
      let cursor: string | undefined;
      do {
        const page = await operation.run(() => client.conversations.list({
          types: 'public_channel',
          exclude_archived: true,
          limit: SLACK_LIST_PAGE_SIZE,
          ...(cursor ? { cursor } : {}),
        }));
        for (const value of page.channels ?? []) {
          const channel = asRecord(value);
          const id = typeof channel.id === 'string' ? channel.id : '';
          if (!id) continue;
          groups.push({ group_id: id, name: String(channel.name ?? id) });
        }
        cursor = page.response_metadata?.next_cursor || undefined;
      } while (cursor);
      return groups;
    },
    // Slack 无"好友"概念：workspace 成员归一为 friend；nickname 取 real_name 回退 name。
    async listFriends(request: EndpointManagementRequest = {}): Promise<readonly EndpointFriend[]> {
      const operation = createEndpointOperation(request);
      const client = requireClient();
      const friends: EndpointFriend[] = [];
      let cursor: string | undefined;
      do {
        const page = await operation.run(() => client.users.list({
          limit: SLACK_LIST_PAGE_SIZE,
          ...(cursor ? { cursor } : {}),
        }));
        for (const value of page.members ?? []) {
          const user = asRecord(value);
          const id = typeof user.id === 'string' ? user.id : '';
          if (!id || user.deleted === true) continue;
          const profile = asRecord(user.profile);
          friends.push({
            user_id: id,
            nickname: String(profile.real_name ?? user.real_name ?? user.name ?? id),
            remark: '',
          });
        }
        cursor = page.response_metadata?.next_cursor || undefined;
      } while (cursor);
      return friends;
    },
    // conversations.members 只回 user id 列表（平台形状），逐 user 拉 profile 成本由调用方决定。
    async listGroupMembers({ groupId, signal }: EndpointGroupRequest): Promise<readonly string[]> {
      const operation = createEndpointOperation({ signal });
      const client = requireClient();
      const result = await operation.run(() => client.conversations.members({ channel: groupId }));
      return result.members ?? [];
    },
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
}

interface SlackReactionRequest extends EndpointManagementRequest {
  readonly channel: string;
  readonly timestamp: string;
  readonly name: string;
}
