/**
 * Slack 统一事件分发 — 两种传输模式共用
 */
import { Message, segment, formatCompact, expandInteractiveSegmentsInContent } from 'zhin.js';
import { toCanonicalSegments } from './segment-mapper.js';
import { parseSlackMessageToSegments, resolveSlackChannelType } from './slack-inbound.js';
import { isSlackNoticeEvent, formatSlackNotice } from './slack-side-events.js';
import { normalizeSlackSenderForPermit } from './platform-permit.js';
import type { SlackEvent, SlackMessageEvent, SlackInteractionPayload, SlackSlashCommand } from './types.js';
import type { SlackEndpoint } from './endpoint.js';
import { formatSlackMessageRef } from './slack-message-ref.js';
import { createSlackInboundFilterState, shouldDropSlackInboundMessage } from './slack-inbound-filter.js';
import { postSlackEphemeral } from './slack-response-url.js';

export class SlackEventDispatcher {
  private readonly inboundFilter = createSlackInboundFilterState();

  constructor(private endpoint: SlackEndpoint) {}

  private get adapter() { return this.endpoint.adapter; }
  private get logger() { return this.endpoint.logger; }

  async routeEvent(event: SlackEvent): Promise<void> {
    const type = event.type;

    if (type === 'message' || type === 'app_mention') {
      await this.handleMessage(event as SlackMessageEvent);
      return;
    }

    if (type === 'assistant_thread_started') {
      this.handleAssistantThreadStarted(event);
      return;
    }

    if (type === 'assistant_thread_context_changed') {
      return;
    }

    if (isSlackNoticeEvent(type)) {
      this.handleNotice(event);
      return;
    }
  }

  routeInteraction(payload: SlackInteractionPayload): void {
    if (payload.type === 'block_actions' && payload.actions?.length) {
      this.handleBlockAction(payload);
    }
  }

  routeSlashCommand(cmd: SlackSlashCommand): void {
    this.handleSlashCommand(cmd);
  }

  private async handleMessage(event: SlackMessageEvent): Promise<void> {
    if (shouldDropSlackInboundMessage(event, this.inboundFilter, this.endpoint.$platformUserId)) {
      return;
    }

    const messageRef = formatSlackMessageRef(event.channel, event.ts);
    this.endpoint.trackMessageChannel(event.ts, event.channel);

    const wire = parseSlackMessageToSegments(event);
    const content = toCanonicalSegments(wire);
    const channelType = resolveSlackChannelType(event);

    const userId = event.user ?? '';
    const userName = (event as any).username ?? (userId || 'Unknown');

    const message = Message.from(event, {
      $id: messageRef,
      $adapter: 'slack',
      $endpoint: this.endpoint.$config.name,
      $sender: { id: userId, name: userName },
      $channel: { id: event.channel, type: channelType },
      $content: content,
      $raw: event.text ?? '',
      $timestamp: parseFloat(event.ts) * 1000,
      $quote_id: event.thread_ts && event.thread_ts !== event.ts ? event.thread_ts : undefined,
      $recall: async () => {
        await this.endpoint.client!.chat.delete({ channel: event.channel, ts: event.ts });
      },
      $reply: async (replyContent, quote?) => {
        if (!Array.isArray(replyContent)) replyContent = [replyContent];
        const threadTs = quote
          ? (typeof quote === 'boolean' ? event.ts : quote)
          : (event.thread_ts ?? undefined);
        return await this.adapter.sendMessage({
          context: 'slack',
          endpoint: this.endpoint.$config.name,
          id: event.channel,
          type: channelType,
          content: replyContent,
          ...(threadTs ? { threadId: threadTs } : {}),
        });
      },
    });

    await this.enrichSender(message, event);
    this.adapter.emit('message.receive', message);
    this.logger.debug(
      `${this.endpoint.$config.name} recv ${message.$channel.type}(${message.$channel.id}): ${segment.raw(message.$content)}`,
    );
  }

  private handleNotice(event: SlackEvent): void {
    const notice = formatSlackNotice(event, this.endpoint.$config.name);
    this.adapter.emit('notice.receive' as any, notice);
    this.logger.debug(formatCompact({
      notice: `${notice.$scene_type}.${notice.$sub_type}`,
      endpoint: this.endpoint.$id,
      scene: notice.$scene_id,
    }));
  }

  private handleBlockAction(payload: SlackInteractionPayload): void {
    const action = payload.actions![0];
    const channelId = payload.channel?.id ?? '';
    const userId = payload.user.id;
    const userName = payload.user.username ?? payload.user.name ?? userId;
    const messageTs = payload.message?.ts ?? '';

    if (payload.response_url) {
      postSlackEphemeral(payload.response_url, '已收到', this.logger);
    }

    const actionSegment = {
      type: 'action',
      data: {
        id: action.action_id,
        value: action.value ?? '',
        payload: JSON.stringify(action),
        text: action.text?.text ?? '',
      },
    };

    const message = Message.from(payload as any, {
      $id: action.action_ts ?? messageTs,
      $adapter: 'slack',
      $endpoint: this.endpoint.$config.name,
      $sender: { id: userId, name: userName },
      $channel: { id: channelId, type: 'group' },
      $content: toCanonicalSegments([actionSegment]),
      $raw: action.text?.text ?? '',
      $timestamp: Date.now(),
      $reply: async (content) => {
        if (!Array.isArray(content)) content = [content];
        return await this.adapter.sendMessage({
          context: 'slack',
          endpoint: this.endpoint.$config.name,
          id: channelId,
          type: 'group',
          content,
          ...(messageTs ? { threadId: messageTs } : {}),
        });
      },
    });

    this.adapter.emit('message.receive', message);
  }

  private handleSlashCommand(cmd: SlackSlashCommand): void {
    const text = `${cmd.command} ${cmd.text}`.trim();

    postSlackEphemeral(cmd.response_url, '处理中…', this.logger);

    const message = Message.from(cmd as any, {
      $id: cmd.trigger_id,
      $adapter: 'slack',
      $endpoint: this.endpoint.$config.name,
      $sender: { id: cmd.user_id, name: cmd.user_name },
      $channel: { id: cmd.channel_id, type: 'group' },
      $content: [{ type: 'text', data: { text } }],
      $raw: text,
      $timestamp: Date.now(),
      $reply: async (content) => {
        if (!Array.isArray(content)) content = [content];
        return await this.adapter.sendMessage({
          context: 'slack',
          endpoint: this.endpoint.$config.name,
          id: cmd.channel_id,
          type: 'group',
          content,
        });
      },
    });

    this.adapter.emit('message.receive', message);
  }

  private handleAssistantThreadStarted(event: SlackEvent): void {
    const thread = (event as any).assistant_thread;
    if (!thread) return;

    const userId = thread.user_id ?? '';
    const channelId = thread.channel_id ?? '';
    const threadTs = thread.thread_ts ?? '';

    const message = Message.from(event, {
      $id: threadTs,
      $adapter: 'slack',
      $endpoint: this.endpoint.$config.name,
      $sender: { id: userId, name: userId },
      $channel: { id: channelId, type: 'private' },
      $content: [{ type: 'text', data: { text: '' } }],
      $raw: '',
      $timestamp: Date.now(),
      $reply: async (content) => {
        if (!Array.isArray(content)) content = [content];
        return await this.adapter.sendMessage({
          context: 'slack',
          endpoint: this.endpoint.$config.name,
          id: channelId,
          type: 'private',
          content,
          threadId: threadTs,
        });
      },
    });

    this.adapter.emit('message.receive', message);
  }

  private async enrichSender(message: Message<any>, event: SlackEvent): Promise<void> {
    if (message.$channel.type !== 'group' || !event.user) return;
    const channelId = event.channel ?? '';
    const userId = event.user;
    const key = `${channelId}:${userId}`;
    const now = Date.now();
    const cached = this.endpoint.senderPermitCache.get(key);
    if (cached && now - cached.at < 60_000) {
      message.$sender.role = cached.role;
      message.$sender.permissions = cached.permissions;
      return;
    }
    try {
      const user = await this.endpoint.getUserInfo(userId);
      let isChannelManager = false;
      try {
        const channel = await this.endpoint.getChannelInfo(channelId);
        if (channel?.creator === userId) isChannelManager = true;
      } catch { /* ignore */ }
      const normalized = normalizeSlackSenderForPermit({
        isWorkspaceOwner: user.is_owner === true,
        isWorkspaceAdmin: user.is_admin === true,
        isChannelManager,
      });
      const entry = { at: now, role: normalized.role, permissions: normalized.permissions ?? [] };
      this.endpoint.senderPermitCache.set(key, entry);
      message.$sender.role = entry.role;
      message.$sender.permissions = entry.permissions;
    } catch { /* conservative deny */ }
  }
}
