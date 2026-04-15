/**
 * Milky SSE Bot：应用 GET 协议端 /event，Accept: text/event-stream，解析 SSE 的 milky_event
 */
import EventSource from 'eventsource';
import { EventEmitter } from 'events';
import { Bot, Message, SendOptions, segment } from 'zhin.js';
import { callApi } from './api.js';
import type { MilkySseConfig, MilkyEvent } from './types.js';
import type { MilkyAdapter } from './adapter.js';
import {
  formatMilkyMessagePayload,
  parseMessageReceiveData,
  toMilkyOutgoingSegments,
  parseMilkyMessageId,
} from './utils.js';

export class MilkySseClient extends EventEmitter implements Bot<MilkySseConfig, MilkyEvent> {
  $connected: boolean;
  private es?: EventSource;

  get logger() {
    return this.adapter.plugin.logger;
  }

  constructor(public adapter: MilkyAdapter, public $config: MilkySseConfig) {
    super();
    this.$connected = false;
  }

  get $id() {
    return this.$config.name;
  }

  private get eventUrl(): string {
    const base = this.$config.baseUrl.replace(/\/$/, '');
    const url = `${base}/event`;
    const token = this.$config.access_token;
    if (token) return `${url}${url.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`;
    return url;
  }

  private apiOptions() {
    return { baseUrl: this.$config.baseUrl, access_token: this.$config.access_token };
  }

  async $connect(): Promise<void> {
    const headers: Record<string, string> = { Accept: 'text/event-stream' };
    if (this.$config.access_token) {
      headers['Authorization'] = `Bearer ${this.$config.access_token}`;
    }
    this.es = new EventSource(this.eventUrl, { headers });
    this.$connected = true;
    if (!this.$config.access_token) this.logger.warn('missing access_token, SSE connection is not secured');

    this.es.addEventListener('milky_event', (e: MessageEvent) => {
      try {
        const event = JSON.parse(e.data) as MilkyEvent;
        this.handleEvent(event);
      } catch (err: unknown) {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      }
    });

    this.es.onerror = (err: unknown) => {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    };
  }

  async $disconnect(): Promise<void> {
    if (this.es) {
      this.es.close();
      this.es = undefined;
    }
    this.$connected = false;
  }

  $formatMessage(event: MilkyEvent): Message<MilkyEvent> {
    const data = parseMessageReceiveData(event);
    if (!data) {
      return Message.from(event, {
        $id: '',
        $adapter: 'milky',
        $bot: this.$config.name,
        $channel: { id: '', type: 'private' },
        $sender: { id: '', name: '' },
        $content: [],
        $raw: '',
        $timestamp: event.time ?? 0,
        $recall: async () => {},
        $reply: async () => '',
      });
    }
    const payload = formatMilkyMessagePayload(
      event,
      data,
      (id) => this.$recallMessage(id),
      (channel, content) =>
        this.adapter.sendMessage({
          ...channel,
          context: 'milky',
          bot: this.$config.name,
          content: content as import('zhin.js').SendContent,
        }),
      'milky',
      this.$config.name,
    );
    return Message.from(event, payload);
  }

  private handleEvent(event: MilkyEvent): void {
    const data = parseMessageReceiveData(event);
    if (data) {
      const message = this.$formatMessage(event);
      this.adapter.emit('message.receive', message);
      this.logger.debug(
        `${this.$config.name} recv ${message.$channel.type}(${message.$channel.id}):${segment.raw(message.$content)}`,
      );
    }
  }

  async $sendMessage(options: SendOptions): Promise<string> {
    const content = Array.isArray(options.content) ? options.content : [options.content];
    const segments = content.map((c) =>
      typeof c === 'string' ? { type: 'text' as const, data: { text: c } } : (c as { type: string; data?: Record<string, unknown> }),
    );
    const message = toMilkyOutgoingSegments(segments);
    if (options.type === 'group') {
      const result = await callApi(this.apiOptions(), 'send_group_message', {
        group_id: parseInt(options.id, 10),
        message,
      });
      const seq = (result as { message_seq?: number }).message_seq;
      this.logger.debug(`${this.$config.name} send group(${options.id}):${segment.raw(options.content)}`);
      return seq != null ? `group:${options.id}:${seq}` : '';
    }
    if (options.type === 'private') {
      const result = await callApi(this.apiOptions(), 'send_private_message', {
        user_id: parseInt(options.id, 10),
        message,
      });
      const seq = (result as { message_seq?: number }).message_seq;
      this.logger.debug(`${this.$config.name} send private(${options.id}):${segment.raw(options.content)}`);
      return seq != null ? `friend:${options.id}:${seq}` : '';
    }
    throw new Error('Either group or private must be provided');
  }

  async $recallMessage(id: string): Promise<void> {
    const parsed = parseMilkyMessageId(id);
    if (!parsed) throw new Error(`Invalid message id: ${id}`);
    if (parsed.message_scene === 'group') {
      await callApi(this.apiOptions(), 'recall_group_message', {
        group_id: parsed.peer_id,
        message_seq: parsed.message_seq,
      });
    } else {
      await callApi(this.apiOptions(), 'recall_private_message', {
        user_id: parsed.peer_id,
        message_seq: parsed.message_seq,
      });
    }
  }

  async kickMember(groupId: number, userId: number, rejectAddRequest = false): Promise<boolean> {
    await callApi(this.apiOptions(), 'kick_group_member', {
      group_id: groupId,
      user_id: userId,
      reject_add_request: rejectAddRequest,
    });
    return true;
  }

  async muteMember(groupId: number, userId: number, duration = 600): Promise<boolean> {
    await callApi(this.apiOptions(), 'set_group_member_mute', {
      group_id: groupId,
      user_id: userId,
      duration,
    });
    return true;
  }

  async muteAll(groupId: number, enable = true): Promise<boolean> {
    await callApi(this.apiOptions(), 'set_group_whole_mute', { group_id: groupId, is_mute: enable });
    return true;
  }

  async setAdmin(groupId: number, userId: number, enable = true): Promise<boolean> {
    await callApi(this.apiOptions(), 'set_group_member_admin', {
      group_id: groupId,
      user_id: userId,
      is_set: enable,
    });
    return true;
  }

  async setCard(groupId: number, userId: number, card: string): Promise<boolean> {
    await callApi(this.apiOptions(), 'set_group_member_card', {
      group_id: groupId,
      user_id: userId,
      card,
    });
    return true;
  }

  async setTitle(groupId: number, userId: number, title: string): Promise<boolean> {
    await callApi(this.apiOptions(), 'set_group_member_special_title', {
      group_id: groupId,
      user_id: userId,
      special_title: title,
    });
    return true;
  }

  async setGroupName(groupId: number, name: string): Promise<boolean> {
    await callApi(this.apiOptions(), 'set_group_name', { group_id: groupId, new_group_name: name });
    return true;
  }

  async getMemberList(groupId: number): Promise<unknown[]> {
    return callApi(this.apiOptions(), 'get_group_member_list', { group_id: groupId }) as Promise<unknown[]>;
  }

  async getGroupInfo(groupId: number): Promise<unknown> {
    return callApi(this.apiOptions(), 'get_group_info', { group_id: groupId });
  }
}
