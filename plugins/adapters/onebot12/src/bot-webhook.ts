/**
 * OneBot 12 HTTP Webhook Bot：OneBot 实现 POST 事件到应用 path，可选 api_url 用于发消息
 */
import { EventEmitter } from 'events';
import { Bot, Message, SendOptions, segment } from 'zhin.js';
import type { Router, RouterContext } from '@zhin.js/http';
import { callOneBot12Action } from './api.js';
import type { OneBot12WebhookConfig, OneBot12Event } from './types.js';
import type { OneBot12Adapter } from './adapter.js';
import { formatOneBot12MessagePayload, isMessageEvent, contentToOb12Segments } from './utils.js';

export class OneBot12WebhookBot extends EventEmitter implements Bot<OneBot12WebhookConfig, OneBot12Event> {
  $connected: boolean = true;

  get logger() {
    return this.adapter.plugin.logger;
  }

  constructor(
    public adapter: OneBot12Adapter,
    public router: Router,
    public $config: OneBot12WebhookConfig,
  ) {
    super();
  }

  get $id() {
    return this.$config.name;
  }

  private httpOptions() {
    const url = this.$config.api_url?.replace(/\/$/, '') ?? '';
    return { url: url || '', access_token: this.$config.access_token };
  }

  async $connect(): Promise<void> {
    const path = this.$config.path.startsWith('/') ? this.$config.path : `/${this.$config.path}`;
    this.router.post(path, async (ctx: RouterContext) => {
      const body = ctx.request.body as OneBot12Event | undefined;
      if (!body || typeof body !== 'object' || !body.id || body.time == null || !body.type) {
        ctx.status = 400;
        ctx.body = { message: 'Invalid OneBot12 event' };
        return;
      }
      const token = this.$config.access_token;
      const auth = ctx.headers['authorization'];
      if (token && auth !== `Bearer ${token}`) {
        ctx.status = 401;
        ctx.body = { message: 'Unauthorized' };
        return;
      }
      this.handleEvent(body);
      ctx.status = 204;
      ctx.body = undefined;
    });
    this.logger.info(`OneBot12 Webhook 注册路径: ${path}`);
  }

  async $disconnect(): Promise<void> {
    this.$connected = false;
  }

  private handleEvent(ev: OneBot12Event): void {
    if (ev.type === 'message' && isMessageEvent(ev)) {
      const message = this.$formatMessage(ev);
      this.adapter.emit('message.receive', message);
      this.logger.debug(`${this.$config.name} recv ${message.$channel.type}(${message.$channel.id}):${segment.raw(message.$content)}`);
    }
  }

  $formatMessage(ev: OneBot12Event): Message<OneBot12Event> {
    if (!isMessageEvent(ev)) {
      return Message.from(ev, {
        $id: '',
        $adapter: 'onebot12',
        $bot: this.$config.name,
        $channel: { id: '', type: 'private' },
        $sender: { id: '', name: '' },
        $content: [],
        $raw: '',
        $timestamp: ev.time ?? 0,
        $recall: async () => {},
        $reply: async () => '',
      });
    }
    const payload = formatOneBot12MessagePayload(
      ev,
      this.$config.name,
      (id) => this.$recallMessage(id),
      (channel, content, _quote) =>
        this.adapter.sendMessage({
          ...channel,
          context: 'onebot12',
          bot: this.$config.name,
          content: content as import('zhin.js').SendContent,
        }),
    );
    return Message.from(ev, payload);
  }

  async $sendMessage(options: SendOptions): Promise<string> {
    const apiUrl = this.$config.api_url;
    if (!apiUrl) {
      throw new Error('OneBot12 Webhook 发消息需要配置 api_url（OneBot 实现的 HTTP 端点）');
    }
    const message = contentToOb12Segments(options.content);
    const params: Record<string, unknown> = { message };
    if (options.type === 'private') {
      params.detail_type = 'private';
      params.user_id = options.id;
    } else if (options.type === 'group') {
      params.detail_type = 'group';
      params.group_id = options.id;
    } else {
      const [guildId, channelId] = options.id.includes(':') ? options.id.split(':') : [undefined, options.id];
      params.detail_type = 'channel';
      params.channel_id = channelId ?? options.id;
      if (guildId) params.guild_id = guildId;
    }
    const data = await callOneBot12Action(this.httpOptions(), 'send_message', params);
    const out = (data as { message_id?: string })?.message_id ?? '';
    return out;
  }

  async $recallMessage(id: string): Promise<void> {
    const apiUrl = this.$config.api_url;
    if (!apiUrl) throw new Error('OneBot12 Webhook 撤回需要配置 api_url');
    await callOneBot12Action(this.httpOptions(), 'delete_message', { message_id: id });
  }
}
