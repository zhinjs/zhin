/**
 * Satori WebHook Bot：应用提供 POST path，SDK 推送 EVENT（Satori-Opcode: 0）
 */
import { EventEmitter } from 'events';
import { Bot, Message, SendOptions, segment } from 'zhin.js';
import type { Router, RouterContext } from '@zhin.js/http';
import { callSatoriApi } from './api.js';
import type { SatoriWebhookConfig, SatoriEventBody, SatoriLogin } from './types.js';
import { SatoriOpcode } from './types.js';
import type { SatoriAdapter } from './adapter.js';
import { formatSatoriMessagePayload, isMessageEvent } from './utils.js';

export class SatoriWebhookBot extends EventEmitter implements Bot<SatoriWebhookConfig, SatoriEventBody> {
  $connected: boolean = true;
  /** 从首个事件的 login 得到，用于 API 的 platform / userId */
  private login?: SatoriLogin;

  get logger() {
    return this.adapter.plugin.logger;
  }

  constructor(
    public adapter: SatoriAdapter,
    public router: Router,
    public $config: SatoriWebhookConfig,
  ) {
    super();
  }

  get $id() {
    return this.$config.name;
  }

  private apiOptions(): { baseUrl: string; platform: string; userId: string; token?: string } {
    const platform = this.login?.platform ?? '';
    const userId = this.login?.user?.id ?? '';
    return { baseUrl: this.$config.baseUrl, platform, userId, token: this.$config.token };
  }

  async $connect(): Promise<void> {
    const path = this.$config.path.startsWith('/') ? this.$config.path : `/${this.$config.path}`;
    this.router.post(path, async (ctx: RouterContext) => {
      const opcode = parseInt(ctx.headers['satori-opcode'] as string ?? '', 10);
      const body = ctx.request.body as SatoriEventBody | undefined;
      if (opcode === SatoriOpcode.EVENT && body) {
        if (body.login && !this.login) this.login = body.login;
        this.handleEvent(body);
      }
      ctx.status = 200;
      ctx.body = {};
    });
    this.logger.info(`Satori WebHook 注册路径: ${path}`);
  }

  async $disconnect(): Promise<void> {
    this.$connected = false;
  }

  private handleEvent(body: SatoriEventBody): void {
    if (isMessageEvent(body)) {
      const message = this.$formatMessage(body);
      this.adapter.emit('message.receive', message);
      this.logger.debug(
        `${this.$config.name} recv ${message.$channel.type}(${message.$channel.id}):${segment.raw(message.$content)}`,
      );
    }
  }

  $formatMessage(body: SatoriEventBody): Message<SatoriEventBody> {
    if (!isMessageEvent(body)) {
      return Message.from(body, {
        $id: '',
        $adapter: 'satori',
        $bot: this.$config.name,
        $channel: { id: '', type: 'private' },
        $sender: { id: '', name: '' },
        $content: [],
        $raw: '',
        $timestamp: body.timestamp ?? 0,
        $recall: async () => {},
        $reply: async () => '',
      });
    }
    const payload = formatSatoriMessagePayload(
      body,
      'satori',
      this.$config.name,
      (id) => this.$recallMessage(id),
      (channel, content, _quote) =>
        this.adapter.sendMessage({
          ...channel,
          context: 'satori',
          bot: this.$config.name,
          content: content as import('zhin.js').SendContent,
        }),
    );
    return Message.from(body, payload);
  }

  async $sendMessage(options: SendOptions): Promise<string> {
    const channelId = options.id;
    const contentRaw = segment.raw(options.content);
    const result = await callSatoriApi(this.apiOptions(), 'message', 'create', {
      channel_id: channelId,
      content: contentRaw,
    });
    const list = Array.isArray(result) ? result : (result as { data?: unknown[] })?.data;
    const msg = list?.[0] as { id?: string } | undefined;
    const msgId = msg?.id ?? '';
    return msgId ? `${channelId}:${msgId}` : '';
  }

  async $recallMessage(id: string): Promise<void> {
    const [channelId, messageId] = id.includes(':') ? id.split(':') : ['', id];
    await callSatoriApi(this.apiOptions(), 'message', 'delete', { channel_id: channelId, message_id: messageId });
  }
}
