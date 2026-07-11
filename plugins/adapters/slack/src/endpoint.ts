/**
 * Slack Endpoint — 双传输（Socket Mode / HTTP）
 */
import { WebClient } from '@slack/web-api';
import { formatCompact, Endpoint, Message, segment, type SendOptions, type EditMessageOptions, expandInteractiveSegmentsInContent } from 'zhin.js';
import type { SlackEndpointConfig, SlackMessageEvent } from './types.js';
import type { SlackAdapter } from './adapter.js';
import { toCanonicalSegments, fromCanonicalSegments } from './segment-mapper.js';
import { parseSlackMessageToSegments, resolveSlackChannelType } from './slack-inbound.js';
import { sendSlackContent, editSlackContent } from './slack-outbound.js';
import { normalizeSlackReactionName } from './slack-reaction.js';
import { formatSlackMessageRef, parseSlackMessageRef } from './slack-message-ref.js';
import { SlackEventDispatcher } from './event-dispatcher.js';
import { SlackSocketTransport } from './transport-socket.js';
import { SlackHttpTransport, type RouterLike } from './transport-http.js';

export class SlackEndpoint implements Endpoint<SlackEndpointConfig, SlackMessageEvent> {
  $connected: boolean;
  /** Slack Bot User ID（auth.test.user_id），用于 @ 触发 AI */
  $platformUserId?: string;
  client?: WebClient;
  /** message ts → channel id（Activity Feedback reaction / recall 定位频道） */
  readonly messageChannelMap = new Map<string, string>();
  senderPermitCache = new Map<string, { at: number; role?: string; permissions: string[] }>();

  private dispatcher?: SlackEventDispatcher;
  private socketTransport?: SlackSocketTransport;
  private httpTransport?: SlackHttpTransport;

  get logger() { return this.adapter.plugin.logger; }
  get $id() { return this.$config.name; }

  constructor(public adapter: SlackAdapter, public $config: SlackEndpointConfig) {
    this.$connected = false;
  }

  async $connect(router?: RouterLike): Promise<void> {
    try {
      this.client = new WebClient(this.$config.token);
      this.dispatcher = new SlackEventDispatcher(this);

      if (this.$config.socketMode) {
        this.socketTransport = new SlackSocketTransport(this.$config, this.dispatcher, this.logger);
        await this.socketTransport.connect();
      } else if (router) {
        this.httpTransport = new SlackHttpTransport(this.$config, this.dispatcher, this.logger);
        this.httpTransport.registerRoutes(router);
      }

      this.$connected = true;

      const authTest = await this.client.auth.test();
      if (authTest.user_id) {
        this.$platformUserId = String(authTest.user_id);
      }
      this.logger.debug(formatCompact({
        endpoint: this.$config.name,
        user: authTest.user,
        platform_user_id: this.$platformUserId,
      }));

      if (!this.$config.socketMode && router) {
        this.logger.debug(formatCompact({ op: 'listen', mode: 'http', path: '/slack/events' }));
      }
    } catch (error) {
      this.logger.error('Failed to connect Slack bot:', error);
      this.$connected = false;
      throw error;
    }
  }

  async $disconnect(): Promise<void> {
    try {
      if (this.socketTransport) {
        await this.socketTransport.disconnect();
        this.socketTransport = undefined;
      }
      this.httpTransport = undefined;
      this.$connected = false;
      this.logger.debug(formatCompact({ op: 'disconnect', endpoint: this.$config.name }));
    } catch (error) {
      this.logger.error('Error disconnecting Slack bot:', error);
      throw error;
    }
  }

  $formatMessage(msg: SlackMessageEvent): Message<SlackMessageEvent> {
    const channelType = resolveSlackChannelType(msg);
    const channelId = msg.channel;
    this.trackMessageChannel(msg.ts, channelId);
    const wire = parseSlackMessageToSegments(msg);
    const content = toCanonicalSegments(wire);
    const userId = msg.user ?? '';
    const userName = (msg as any).username ?? (userId || 'Unknown');
    const messageText = msg.text ?? '';

    this.trackMessageChannel(msg.ts, channelId);

    const result = Message.from(msg, {
      $id: formatSlackMessageRef(channelId, msg.ts),
      $adapter: 'slack',
      $endpoint: this.$config.name,
      $sender: { id: userId, name: userName },
      $channel: { id: channelId, type: channelType },
      $content: content,
      $raw: messageText,
      $timestamp: parseFloat(msg.ts) * 1000,
      $quote_id: msg.thread_ts && msg.thread_ts !== msg.ts ? msg.thread_ts : undefined,
      $recall: async () => {
        await this.client!.chat.delete({ channel: channelId, ts: msg.ts });
      },
      $reply: async (replyContent, quote?) => {
        if (!Array.isArray(replyContent)) replyContent = [replyContent];
        const threadTs = quote
          ? (typeof quote === 'boolean' ? msg.ts : quote)
          : (msg.thread_ts ?? undefined);
        return await this.adapter.sendMessage({
          context: 'slack',
          endpoint: this.$config.name,
          id: channelId,
          type: channelType,
          content: replyContent,
          ...(threadTs ? { threadId: threadTs } : {}),
        });
      },
    });

    return result;
  }

  async $sendMessage(options: SendOptions): Promise<string> {
    try {
      const canonical = expandInteractiveSegmentsInContent(options.content);
      const wire = fromCanonicalSegments(canonical);
      const result = await sendSlackContent(this.client!, wire, {
        channel: options.id,
        threadTs: options.threadId,
      }, this.logger);
      this.logger.debug(
        `${this.$config.name} send ${options.type}(${options.id}): ${segment.raw(options.content)}`,
      );
      this.trackMessageChannel(result.ts, options.id);
      return formatSlackMessageRef(options.id, result.ts);
    } catch (error) {
      this.logger.error('Failed to send Slack message:', error);
      throw error;
    }
  }

  async $editMessage(options: EditMessageOptions): Promise<void> {
    const ref = parseSlackMessageRef(options.messageId);
    const channel = ref?.channel ?? options.id;
    const ts = ref?.ts ?? options.messageId;
    const canonical = expandInteractiveSegmentsInContent(options.content);
    const wire = fromCanonicalSegments(canonical);
    await editSlackContent(this.client!, channel, ts, wire);
  }

  async $recallMessage(id: string): Promise<void> {
    const ref = this.resolveMessageRef(id);
    if (!ref) {
      this.logger.warn(formatCompact({ op: 'recall_skip', reason: 'channel_unknown', message_id: id }));
      return;
    }
    try {
      await this.client!.chat.delete({ channel: ref.channel, ts: ref.ts });
    } catch (error: unknown) {
      const slackError = (error as { data?: { error?: string } })?.data?.error;
      if (slackError === 'message_not_found') {
        this.logger.debug(formatCompact({ op: 'recall_skip', reason: 'message_not_found', message_id: id }));
        return;
      }
      throw error;
    }
  }

  trackMessageChannel(ts: string, channel: string): void {
    if (ts && channel) {
      this.messageChannelMap.set(ts, channel);
    }
  }

  resolveMessageRef(messageId: string, channelHint?: string): { channel: string; ts: string } | null {
    const parsed = parseSlackMessageRef(messageId);
    if (parsed) {
      this.trackMessageChannel(parsed.ts, parsed.channel);
      return parsed;
    }
    if (channelHint) {
      return { channel: channelHint, ts: messageId };
    }
    const channel = this.messageChannelMap.get(messageId);
    if (channel) {
      return { channel, ts: messageId };
    }
    return null;
  }

  /**
   * Activity Feedback：在用户消息上添加表情回应
   * @returns reaction name，供 $removeReaction 使用
   */
  async $addReaction(
    messageId: string,
    emoji: string,
    hint?: { sceneType?: 'private' | 'group' | 'channel'; channelId?: string },
  ): Promise<string | null> {
    const ref = this.resolveMessageRef(messageId, hint?.channelId);
    if (!ref) {
      this.logger.warn(formatCompact({ op: 'reaction_add_skip', reason: 'channel_unknown', message_id: messageId }));
      return null;
    }
    const name = normalizeSlackReactionName(emoji);
    try {
      await this.addReaction(ref.channel, ref.ts, name);
      return name;
    } catch (error) {
      this.logger.error('Failed to add Slack reaction:', error);
      return null;
    }
  }

  /** Activity Feedback：移除本 Bot 在消息上的表情回应 */
  async $removeReaction(messageId: string, reactionId: string, channelHint?: string): Promise<void> {
    const ref = this.resolveMessageRef(messageId, channelHint);
    if (!ref) {
      this.logger.warn(formatCompact({ op: 'reaction_remove_skip', reason: 'channel_unknown', message_id: messageId }));
      return;
    }
    const name = normalizeSlackReactionName(reactionId);
    try {
      await this.removeReaction(ref.channel, ref.ts, name);
    } catch (error) {
      const code = (error as { data?: { error?: string } })?.data?.error;
      if (code === 'no_reaction') return;
      this.logger.error('Failed to remove Slack reaction:', error);
    }
  }

  // ==================== 工作区管理 API ====================

  async inviteToChannel(channel: string, users: string[]): Promise<boolean> {
    await this.client!.conversations.invite({ channel, users: users.join(',') });
    this.logger.debug(formatCompact({ op: 'invite', endpoint: this.$id, channel, users: users.join(',') }));
    return true;
  }

  async kickFromChannel(channel: string, user: string): Promise<boolean> {
    await this.client!.conversations.kick({ channel, user });
    this.logger.debug(formatCompact({ op: 'kick', endpoint: this.$id, channel, user }));
    return true;
  }

  async setChannelTopic(channel: string, topic: string): Promise<boolean> {
    await this.client!.conversations.setTopic({ channel, topic });
    this.logger.debug(formatCompact({ op: 'set_topic', endpoint: this.$id, channel }));
    return true;
  }

  async setChannelPurpose(channel: string, purpose: string): Promise<boolean> {
    await this.client!.conversations.setPurpose({ channel, purpose });
    this.logger.debug(formatCompact({ op: 'set_purpose', endpoint: this.$id, channel }));
    return true;
  }

  async archiveChannel(channel: string): Promise<boolean> {
    await this.client!.conversations.archive({ channel });
    this.logger.debug(formatCompact({ op: 'archive', endpoint: this.$id, channel }));
    return true;
  }

  async unarchiveChannel(channel: string): Promise<boolean> {
    await this.client!.conversations.unarchive({ channel });
    this.logger.debug(formatCompact({ op: 'unarchive', endpoint: this.$id, channel }));
    return true;
  }

  async renameChannel(channel: string, name: string): Promise<boolean> {
    await this.client!.conversations.rename({ channel, name });
    this.logger.debug(formatCompact({ op: 'rename', endpoint: this.$id, channel, name }));
    return true;
  }

  async getChannelMembers(channel: string): Promise<string[]> {
    const result = await this.client!.conversations.members({ channel });
    return result.members || [];
  }

  async getChannelInfo(channel: string): Promise<any> {
    const result = await this.client!.conversations.info({ channel });
    return result.channel;
  }

  async getUserInfo(user: string): Promise<any> {
    const result = await this.client!.users.info({ user });
    return result.user;
  }

  async addReaction(channel: string, timestamp: string, name: string): Promise<boolean> {
    try {
      await this.client!.reactions.add({ channel, timestamp, name });
      this.logger.debug(formatCompact({ op: 'reaction_add', endpoint: this.$id, name }));
      return true;
    } catch (error) {
      const code = (error as { data?: { error?: string } })?.data?.error;
      if (code === 'already_reacted') {
        this.logger.debug(formatCompact({ op: 'reaction_add', endpoint: this.$id, name, status: 'exists' }));
        return true;
      }
      throw error;
    }
  }

  async removeReaction(channel: string, timestamp: string, name: string): Promise<boolean> {
    try {
      await this.client!.reactions.remove({ channel, timestamp, name });
      this.logger.debug(formatCompact({ op: 'reaction_remove', endpoint: this.$id, name }));
      return true;
    } catch (error) {
      const code = (error as { data?: { error?: string } })?.data?.error;
      if (code === 'no_reaction') {
        this.logger.debug(formatCompact({ op: 'reaction_remove', endpoint: this.$id, name, status: 'gone' }));
        return true;
      }
      throw error;
    }
  }

  async pinMessage(channel: string, timestamp: string): Promise<boolean> {
    await this.client!.pins.add({ channel, timestamp });
    this.logger.debug(formatCompact({ op: 'pin', endpoint: this.$id, channel }));
    return true;
  }

  async unpinMessage(channel: string, timestamp: string): Promise<boolean> {
    await this.client!.pins.remove({ channel, timestamp });
    this.logger.debug(formatCompact({ op: 'unpin', endpoint: this.$id, channel }));
    return true;
  }
}
