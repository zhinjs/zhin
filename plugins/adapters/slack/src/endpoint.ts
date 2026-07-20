/**
 * SlackEndpoint — lifecycle, outbound, admit, Socket Mode, agent tool surface.
 */
import { SocketModeClient } from '@slack/socket-mode';
import { WebClient } from '@slack/web-api';
import type { EndpointInstance } from '@zhin.js/adapter';
import type { MessageGateway } from '@zhin.js/core/runtime';
import type { HttpHost, HttpRouteRegistration } from '@zhin.js/host-http';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { CapabilityId } from '@zhin.js/plugin-runtime';
import {
  formatInboundContent,
  formatInteractionContent,
  formatSlashContent,
  inboundMessageId,
  resolveSlackChannelType,
  type ResolvedSlackConfig,
  type SlackEvent,
  type SlackEventEnvelope,
  type SlackInteractionPayload,
  type SlackMessageEvent,
  type SlackSlashCommand,
} from './protocol.js';
import { registerSlackAgentEndpoint } from './slack-agent-deps.js';
import {
  createSlackInboundFilterState,
  shouldDropSlackInboundMessage,
} from './slack-inbound-filter.js';
import { formatSlackMessageRef, parseSlackMessageRef } from './slack-message-ref.js';
import { normalizeSlackReactionName } from './slack-reaction.js';
import { postSlackEphemeral } from './slack-response-url.js';
import { editSlackContent, sendSlackContent, type SlackChatClient } from './slack-outbound.js';
import { registerSlackWebhookRoutes, type SlackWebhookHandler } from './webhook.js';

const logger = getLogger('slack');

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
  };
  users: {
    info(opts: { user: string }): Promise<{ user?: unknown }>;
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
  readonly gateway: MessageGateway;
  readonly config: ResolvedSlackConfig;
  readonly http?: HttpHost;
  readonly createClient?: (token: string) => SlackWebClientLike;
  readonly createSocket?: (opts: {
    readonly appToken: string;
    readonly clientPingTimeout: number;
  }) => SlackSocketLike;
}

export class SlackEndpoint implements EndpointInstance, SlackWebhookHandler {
  readonly #options: SlackEndpointOptions;
  readonly #inboundFilter = createSlackInboundFilterState();
  readonly #messageChannelMap = new Map<string, string>();
  #client?: SlackWebClientLike;
  #socket?: SlackSocketLike;
  #routeReleases: HttpRouteRegistration[] = [];
  #botUserId?: string;
  #open = false;
  #started = false;
  #unregisterAgent?: () => void;

  constructor(options: SlackEndpointOptions) {
    this.#options = options;
  }

  get client(): SlackWebClientLike | undefined {
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

      this.#unregisterAgent = registerSlackAgentEndpoint(config.name, this);

      if (config.mode === 'socket') {
        await this.#startSocket();
      } else {
        const http = this.#options.http;
        if (!http) {
          throw new Error('Slack HTTP Events API requires httpHostToken (Runtime Host)');
        }
        this.#routeReleases.push(...registerSlackWebhookRoutes(http, this));
        logger.debug(formatCompact({
          endpoint: config.name,
          op: 'webhook',
          path: config.webhookPath,
        }));
      }

      const authTest = await this.#client.auth.test();
      if (authTest.user_id) this.#botUserId = String(authTest.user_id);

      logger.info(formatCompact({
        op: 'connect',
        endpoint: config.name,
        mode: config.mode,
        platform_user_id: this.#botUserId,
      }));
    } catch (error) {
      await this.stop();
      logger.error('Failed to connect Slack endpoint:', error);
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
    this.#unregisterAgent?.();
    this.#unregisterAgent = undefined;
    this.#client = undefined;
    this.#started = false;
    logger.debug(formatCompact({ op: 'disconnect', endpoint: this.#options.config.name }));
  }

  async send({ target, payload }: { readonly target: string; readonly payload: unknown }): Promise<string> {
    if (!this.#client) throw new Error('Slack client not connected');
    const { channel, threadTs } = parseSendTarget(target);
    const result = await sendSlackContent(
      this.#client,
      payload,
      { channel, threadTs },
      logger,
    );
    if (result.ts) this.trackMessageChannel(result.ts, channel);
    return formatSlackMessageRef(channel, result.ts || String(Date.now()));
  }

  /** Test / internal: admit a message event when open. */
  admit(event: SlackMessageEvent | SlackEvent): void {
    if (!this.#open) return;
    if (event.type !== 'message' && event.type !== 'app_mention') return;
    const msg = event as SlackMessageEvent;
    if (shouldDropSlackInboundMessage(msg, this.#inboundFilter, this.#botUserId)) return;
    if (!msg.channel || !msg.ts) return;

    this.trackMessageChannel(msg.ts, msg.channel);
    void this.#options.gateway.receive({
      adapter: this.#options.id,
      target: msg.channel,
      content: formatInboundContent(msg),
      sender: msg.user ?? msg.channel,
      id: inboundMessageId(msg),
      metadata: Object.freeze({
        endpoint: this.#options.config.name,
        channelType: resolveSlackChannelType(msg),
        userId: msg.user,
        threadTs: msg.thread_ts && msg.thread_ts !== msg.ts ? msg.thread_ts : undefined,
        ts: msg.ts,
        // app_mention 事件本身即 @ 机器人；新 Runtime 纯文本 content 需经 metadata 传递
        ...(msg.type === 'app_mention' ? { mentioned: true } : {}),
      }),
    }).catch((err) => {
      logger.warn(formatCompact({
        op: 'slack_gateway_receive_failed',
        target: msg.channel,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  admitInteraction(payload: SlackInteractionPayload): void {
    if (!this.#open) return;
    if (payload.type !== 'block_actions' || !payload.actions?.length) return;
    const channelId = payload.channel?.id ?? '';
    const userId = payload.user.id;
    const messageTs = payload.message?.ts ?? '';
    if (payload.response_url) {
      postSlackEphemeral(payload.response_url, '已收到', logger);
    }
    void this.#options.gateway.receive({
      adapter: this.#options.id,
      target: channelId || userId,
      content: formatInteractionContent(payload),
      sender: userId,
      id: payload.actions[0]?.action_ts ?? messageTs ?? `action-${Date.now()}`,
      metadata: Object.freeze({
        endpoint: this.#options.config.name,
        eventType: 'block_actions',
        actionId: payload.actions[0]?.action_id,
        threadTs: messageTs || undefined,
      }),
    }).catch((err) => {
      logger.warn(formatCompact({
        op: 'slack_gateway_receive_failed',
        target: channelId,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  admitSlashCommand(cmd: SlackSlashCommand): void {
    if (!this.#open) return;
    postSlackEphemeral(cmd.response_url, '处理中…', logger);
    void this.#options.gateway.receive({
      adapter: this.#options.id,
      target: cmd.channel_id,
      content: formatSlashContent(cmd),
      sender: cmd.user_id,
      id: cmd.trigger_id,
      metadata: Object.freeze({
        endpoint: this.#options.config.name,
        eventType: 'slash_command',
        command: cmd.command,
      }),
    }).catch((err) => {
      logger.warn(formatCompact({
        op: 'slack_gateway_receive_failed',
        target: cmd.channel_id,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  handleEnvelope(body: unknown): void {
    const envelope = body as SlackEventEnvelope;
    if (envelope?.type === 'event_callback' && envelope.event) {
      this.admit(envelope.event);
    }
  }

  trackMessageChannel(ts: string, channel: string): void {
    if (ts && channel) this.#messageChannelMap.set(ts, channel);
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

  async editMessage(channel: string, messageTs: string, content: unknown): Promise<void> {
    if (!this.#client) throw new Error('Slack client not connected');
    await editSlackContent(this.#client, channel, messageTs, content);
  }

  // ── Agent tool surface ──────────────────────────────────────────────

  async inviteToChannel(channel: string, users: string[]): Promise<boolean> {
    await this.#client!.conversations.invite({ channel, users: users.join(',') });
    return true;
  }

  async kickFromChannel(channel: string, user: string): Promise<boolean> {
    await this.#client!.conversations.kick({ channel, user });
    return true;
  }

  async setChannelTopic(channel: string, topic: string): Promise<boolean> {
    await this.#client!.conversations.setTopic({ channel, topic });
    return true;
  }

  async setChannelPurpose(channel: string, purpose: string): Promise<boolean> {
    await this.#client!.conversations.setPurpose({ channel, purpose });
    return true;
  }

  async archiveChannel(channel: string): Promise<boolean> {
    await this.#client!.conversations.archive({ channel });
    return true;
  }

  async unarchiveChannel(channel: string): Promise<boolean> {
    await this.#client!.conversations.unarchive({ channel });
    return true;
  }

  async renameChannel(channel: string, name: string): Promise<boolean> {
    await this.#client!.conversations.rename({ channel, name });
    return true;
  }

  async getChannelMembers(channel: string): Promise<string[]> {
    const result = await this.#client!.conversations.members({ channel });
    return result.members || [];
  }

  async getChannelInfo(channel: string): Promise<unknown> {
    const result = await this.#client!.conversations.info({ channel });
    return result.channel;
  }

  async getUserInfo(user: string): Promise<unknown> {
    const result = await this.#client!.users.info({ user });
    return result.user;
  }

  async addReaction(channel: string, timestamp: string, name: string): Promise<boolean> {
    const reaction = normalizeSlackReactionName(name);
    try {
      await this.#client!.reactions.add({ channel, timestamp, name: reaction });
      return true;
    } catch (error) {
      const code = (error as { data?: { error?: string } })?.data?.error;
      if (code === 'already_reacted') return true;
      throw error;
    }
  }

  async removeReaction(channel: string, timestamp: string, name: string): Promise<boolean> {
    const reaction = normalizeSlackReactionName(name);
    try {
      await this.#client!.reactions.remove({ channel, timestamp, name: reaction });
      return true;
    } catch (error) {
      const code = (error as { data?: { error?: string } })?.data?.error;
      if (code === 'no_reaction') return true;
      throw error;
    }
  }

  async pinMessage(channel: string, timestamp: string): Promise<boolean> {
    await this.#client!.pins.add({ channel, timestamp });
    return true;
  }

  async unpinMessage(channel: string, timestamp: string): Promise<boolean> {
    await this.#client!.pins.remove({ channel, timestamp });
    return true;
  }

  async #startSocket(): Promise<void> {
    const { config } = this.#options;
    if (!config.appToken) throw new Error('Socket Mode requires appToken');
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

function parseSendTarget(target: string): { channel: string; threadTs?: string } {
  const parsed = parseSlackMessageRef(target);
  if (parsed && /^\d+\.\d+$/.test(parsed.ts)) {
    return { channel: parsed.channel, threadTs: parsed.ts };
  }
  return { channel: target };
}
