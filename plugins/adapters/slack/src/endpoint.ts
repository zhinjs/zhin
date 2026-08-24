import { Endpoint } from 'zhin.js/adapter';
/**
 * SlackEndpoint — lifecycle, outbound, admit, Socket Mode, agent tool surface.
 */
import { SocketModeClient } from '@slack/socket-mode';
import { WebClient } from '@slack/web-api';
import type {
  EndpointFriend,
  EndpointGroup,
  EndpointControl,
  EndpointManagement,
  EndpointSendRequest,
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
import { editSlackContent, sendSlackContent, type SlackChatClient } from './slack-outbound.js';
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

export interface SlackWebClientLike extends SlackChatClient {
  auth: {
    test(): Promise<{ user_id?: string; user?: string }>;
  };
  conversations: {
    invite(opts: { channel: string; users: string }): Promise<unknown>;
    kick(opts: { channel: string; user: string }): Promise<unknown>;
    setTopic(opts: { channel: string; topic: string }): Promise<unknown>;
    setPurpose(opts: { channel: string; purpose: string }): Promise<unknown>;
    archive(opts: { channel: string }): Promise<unknown>;
    unarchive(opts: { channel: string }): Promise<unknown>;
    rename(opts: { channel: string; name: string }): Promise<unknown>;
    members(opts: { channel: string }): Promise<{ members?: string[] }>;
    info(opts: { channel: string }): Promise<{ channel?: unknown }>;
    list(opts?: {
      types?: string;
      limit?: number;
      cursor?: string;
      exclude_archived?: boolean;
    }): Promise<{ channels?: unknown[]; response_metadata?: { next_cursor?: string } }>;
  };
  users: {
    info(opts: { user: string }): Promise<{ user?: unknown }>;
    list(opts?: {
      limit?: number;
      cursor?: string;
    }): Promise<{ members?: unknown[]; response_metadata?: { next_cursor?: string } }>;
  };
  reactions: {
    add(opts: { channel: string; timestamp: string; name: string }): Promise<unknown>;
    remove(opts: { channel: string; timestamp: string; name: string }): Promise<unknown>;
  };
  pins: {
    add(opts: { channel: string; timestamp: string }): Promise<unknown>;
    remove(opts: { channel: string; timestamp: string }): Promise<unknown>;
  };
  chat: SlackChatClient['chat'] & {
    delete(opts: { channel: string; ts: string }): Promise<unknown>;
  };
}

export interface SlackEndpointOptions {
  readonly id: CapabilityId;
  readonly config: ResolvedSlackConfig;
  readonly http?: HttpHost;
  readonly createClient?: (token: string) => SlackWebClientLike;
  readonly createSocket?: (opts: {
    readonly appToken: string;
    readonly clientPingTimeout: number;
  }) => SlackSocketLike;
}

export class SlackEndpoint extends Endpoint<SlackWebClientLike> implements SlackWebhookHandler {
  readonly #logger!: ReturnType<typeof getAdapterLogger>;

  readonly #options: SlackEndpointOptions;
  readonly #inboundFilter = createSlackInboundFilterState();
  readonly #messageChannelMap = new Map<string, string>();
  #client?: SlackWebClientLike;
  #socket?: SlackSocketLike;
  #routeReleases: HttpRouteRegistration[] = [];
  #botUserId?: string;
  #open = false;
  #started = false;
  readonly management: EndpointManagement = createSlackEndpointManagement(() => this.client);
  readonly control: EndpointControl = Object.freeze<EndpointControl>({
    recall: async (message) => {
      const ref = this.resolveMessageRef(message.id, message.conversation.id);
      if (!ref || !this.#client) return;
      await this.#client.chat.delete(ref);
    },
    edit: async (message, content) => {
      const ref = this.resolveMessageRef(message.id, message.conversation.id);
      if (!ref) return null;
      await this.#editMessage(ref.channel, ref.ts, content);
      return message.id;
    },
    addReaction: async (message, emoji) => {
      const ref = this.resolveMessageRef(message.id, message.conversation.id);
      if (!ref) return null;
      const reaction = normalizeSlackReactionName(emoji);
      await this.#addReaction(ref.channel, ref.ts, reaction);
      return reaction;
    },
    removeReaction: async (message, reactionId) => {
      const ref = this.resolveMessageRef(message.id, message.conversation.id);
      if (!ref) return;
      await this.#removeReaction(ref.channel, ref.ts, reactionId);
    },
  });

  constructor(options: SlackEndpointOptions) {
    super();
    this.#logger = getAdapterLogger('slack', options.config.id);
    this.#options = options;
  }

  /** Console 展示 / AdapterIndex live name（多 endpoint 时与 entry name 一致）。 */
  get name(): string {
    return this.#options.config.id;
  }

  get client(): SlackWebClientLike {
    if (!this.#client) throw new Error('Slack client not connected');
    return this.#client;
  }

  get platformUserId(): string | undefined {
    return this.#botUserId;
  }

  get config(): ResolvedSlackConfig {
    return this.#options.config;
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    try {
      const { config } = this.#options;
      this.#client = this.#options.createClient?.(config.token)
        ?? (new WebClient(config.token) as unknown as SlackWebClientLike);

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

      const authTest = await this.#client.auth.test();
      if (authTest.user_id) this.#botUserId = String(authTest.user_id);

      this.#logger.info(
        `connected (${config.mode})`
        + (this.#botUserId ? ` | user: ${this.#botUserId}` : ''),
      );
    } catch (error) {
      await this.stop();
      this.#logger.error('Failed to connect Slack endpoint:', error);
      throw error;
    }
  }

  open(): void {
    this.#open = true;
  }

  close(): void {
    this.#open = false;
  }

  async stop(): Promise<void> {
    this.#open = false;
    if (this.#socket) {
      try {
        await this.#socket.disconnect();
      } catch {
        /* ignore */
      }
      this.#socket = undefined;
    }
    for (const release of this.#routeReleases.splice(0)) release();
    this.#client = undefined;
    this.#started = false;
    this.#logger.debug(formatCompact({ op: 'disconnect' }));
  }

  async send({ conversation, payload }: EndpointSendRequest): Promise<string> {
    if (!this.#client) throw new Error('Slack client not connected');
    const channel = conversation.id;
    const threadTs = conversation.threadId;
    const result = await sendSlackContent(
      this.#client,
      payload,
      { channel, threadTs },
      this.#logger,
    );
    if (result.ts) this.trackMessageChannel(result.ts, channel);
    return formatSlackMessageRef(channel, result.ts || String(Date.now()));
  }

  /** Test / internal: admit a message event when open. */
  admit(event: SlackMessageEvent | SlackEvent): void {
    if (!this.#open) return;
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
    void this.emit('message.receive', {
      conversation,
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
  }

  admitInteraction(payload: SlackInteractionPayload): void {
    if (!this.#open) return;
    void this.#emitPlatformEvent(`interaction.${payload.type}`, payload);
    if (payload.type !== 'block_actions' || !payload.actions?.length) return;
    const channelId = payload.channel?.id ?? '';
    const userId = payload.user.id;
    const messageTs = payload.message?.ts ?? '';
    if (payload.response_url) {
      postSlackEphemeral(payload.response_url, '已收到', this.#logger);
    }
    const actionTs = payload.actions[0]?.action_ts ?? messageTs ?? `action-${Date.now()}`;
    const conversation = slackInboundConversation(String(this.#options.id), {
      channelId: channelId || userId,
      // block_actions 无 channel_type；无 channel 时按与发起用户的 DM 处理
      channelType: channelId ? undefined : 'im',
    });
    void this.emit('message.receive', {
      conversation,
      message: { conversation, id: actionTs },
      content: formatInteractionContent(payload),
      sender: { id: userId },
      endpointId: this.#options.config.id,
      metadata: Object.freeze({
        eventType: 'block_actions',
        actionId: payload.actions[0]?.action_id,
        threadTs: messageTs || undefined,
      }),
    }).catch((err) => {
      this.#logger.warn(formatCompact({
        op: 'slack_gateway_receive_failed',
        target: `${conversation.kind}:${conversation.id}`,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  admitSlashCommand(cmd: SlackSlashCommand): void {
    if (!this.#open) return;
    void this.#emitPlatformEvent(`slash.${cmd.command}`, cmd);
    postSlackEphemeral(cmd.response_url, '处理中…', this.#logger);
    const conversation = slackInboundConversation(String(this.#options.id), {
      channelId: cmd.channel_id,
    });
    void this.emit('message.receive', {
      conversation,
      message: { conversation, id: cmd.trigger_id },
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
  }

  handleEnvelope(body: unknown): void {
    const envelope = body as SlackEventEnvelope;
    if (envelope?.type === 'event_callback' && envelope.event) {
      const event = envelope.event;
      if (event.type !== 'message' && event.type !== 'app_mention') {
        void this.#emitPlatformEvent(event.type || 'event', event);
        receiveSlackSideEvent(
          (name, payload) => this.emit(name, payload),
          String(this.#options.id),
          this.#options.config.id,
          event,
          this.#logger,
        );
        return;
      }
      this.admit(event);
    }
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
    if (!this.#client) return;
    const ref = this.resolveMessageRef(messageId);
    if (!ref) return;
    await this.#client.chat.delete({ channel: ref.channel, ts: ref.ts });
  }

  async #editMessage(channel: string, messageTs: string, content: unknown): Promise<void> {
    if (!this.#client) throw new Error('Slack client not connected');
    await editSlackContent(this.#client, channel, messageTs, content);
  }

  async #addReaction(channel: string, timestamp: string, name: string): Promise<void> {
    const reaction = normalizeSlackReactionName(name);
    try {
      await this.#client!.reactions.add({ channel, timestamp, name: reaction });
    } catch (error) {
      const code = (error as { data?: { error?: string } })?.data?.error;
      if (code === 'already_reacted') return;
      throw error;
    }
  }

  async #removeReaction(channel: string, timestamp: string, name: string): Promise<void> {
    const reaction = normalizeSlackReactionName(name);
    try {
      await this.#client!.reactions.remove({ channel, timestamp, name: reaction });
    } catch (error) {
      const code = (error as { data?: { error?: string } })?.data?.error;
      if (code === 'no_reaction') return;
      throw error;
    }
  }

  async #emitPlatformEvent(name: string, event: unknown): Promise<void> {
    await this.emitPlatform(name, event).catch((error) => {
      this.#logger.warn(formatCompact({
        op: 'slack_platform_event_failed',
        event: name,
        error: error instanceof Error ? error.message : String(error),
      }));
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
    this.#socket = this.#options.createSocket?.({
      appToken: config.appToken,
      clientPingTimeout: config.clientPingTimeout,
    }) ?? new SocketModeClient({
      appToken: config.appToken,
      clientPingTimeout: config.clientPingTimeout,
    }) as unknown as SlackSocketLike;

    this.#socket.on('slack_event', async ({ ack, body }) => {
      await ack();
      this.handleEnvelope(body);
    });
    this.#socket.on('interactive', async ({ ack, body }) => {
      await ack();
      this.admitInteraction(body as SlackInteractionPayload);
    });
    this.#socket.on('slash_commands', async ({ ack, body }) => {
      await ack();
      this.admitSlashCommand(body as SlackSlashCommand);
    });

    await this.#socket.start();
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
    async listGroups(): Promise<readonly EndpointGroup[]> {
      const client = requireClient();
      const groups: EndpointGroup[] = [];
      let cursor: string | undefined;
      do {
        const page = await client.conversations.list({
          types: 'public_channel',
          exclude_archived: true,
          limit: SLACK_LIST_PAGE_SIZE,
          ...(cursor ? { cursor } : {}),
        });
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
    async listFriends(): Promise<readonly EndpointFriend[]> {
      const client = requireClient();
      const friends: EndpointFriend[] = [];
      let cursor: string | undefined;
      do {
        const page = await client.users.list({
          limit: SLACK_LIST_PAGE_SIZE,
          ...(cursor ? { cursor } : {}),
        });
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
    async listGroupMembers(groupId: string): Promise<readonly string[]> {
      const client = requireClient();
      const result = await client.conversations.members({ channel: groupId });
      return result.members ?? [];
    },
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
}
