/**
 * KOOK WebSocket transport: kook-client wrapper and inbound message normalization.
 */
import path from 'node:path';
import { createKookApiAgent, type KookApiProxy } from './api-proxy.js';
import { readFile } from 'node:fs/promises';
import { EndpointDeliveryError } from '@zhin.js/im-contract';
import { Client, WebsocketReceiver } from 'kook-client';
import { createKookStreamSocket } from './stream-proxy.js';
import { createEndpointLifecycle, type EndpointTransportState } from 'zhin.js/adapter';
import {
  type KookInboundMessage,
  type ResolvedKookConfig,
  type ResolvedKookWebhookConfig,
  type ResolvedKookWebsocketConfig,
} from './protocol.js';

/** Minimal client surface used by the endpoint (real kook-client or test mock). */
export interface KookClientTransport {
  getTransportState?(): EndpointTransportState | undefined;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  on(event: string, listener: (...args: unknown[]) => void): void;
  removeAllListeners(): void;
  sendChannelMsg(
    channelId: string,
    message: unknown,
    quote?: { message_id: string },
  ): Promise<{ msg_id?: string | number }>;
  sendPrivateMsg(
    userId: string,
    message: unknown,
    quote?: { message_id: string },
  ): Promise<{ msg_id?: string | number }>;
  uploadMedia?(data: Buffer): Promise<string>;
  recallChannelMsg?(channelId: string, messageId: string): Promise<boolean>;
  recallPrivateMsg?(userId: string, messageId: string): Promise<boolean>;
  pickGuild(guildId: string): {
    kick(userId: string): Promise<boolean>;
    getRoleList(): Promise<Array<{
      role_id: string | number;
      name: string;
      color?: number;
      position?: number;
      permissions?: unknown;
    }>>;
    createRole(name: string): Promise<{ role_id: string | number; name: string }>;
    deleteRole(roleId: string): Promise<boolean>;
  };
  pickGuildMember(guildId: string, userId: string): {
    addToBlackList(remark?: string, delMsgDays?: number): Promise<boolean>;
    removeFromBlackList(): Promise<boolean>;
    grant(roleId: string): Promise<boolean>;
    revoke(roleId: string): Promise<boolean>;
    setNickname(nickname: string): Promise<boolean>;
  };
  /** GET /api/v3/guild/list（kook-client 内部分页聚合）。 */
  getGuildList(): Promise<Array<{ id: string | number; name?: string }>>;
  /** GET /api/v3/channel/list（type: 1=文字 2=语音；is_category 为分组）。 */
  getChannelList(guildId: string): Promise<Array<{
    id: string | number;
    name?: string;
    type?: string | number;
    is_category?: boolean;
  }>>;
  /** GET /api/v3/guild/user-list。 */
  getGuildUserList(guildId: string, channelId?: string): Promise<unknown[]>;
  self_id?: string | number;
}

export type CreateKookClient = (config: ResolvedKookConfig) => KookClientTransport;

export function normalizeKookMessage(raw: unknown): KookInboundMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const msg = raw as {
    message_id?: string | number;
    message_type?: string;
    author_id?: string | number;
    timestamp?: number;
    raw_message?: string;
    channel_id?: string | number;
    author?: { info?: { nickname?: string; username?: string; bot?: boolean; roles?: number[] }; bot?: boolean; roles?: number[] };
    message?: Array<{ type?: string; text?: string }>;
    channel?: { info?: { guild_id?: string } };
  };
  if (msg.message_id == null || msg.author_id == null) return null;

  const channelKind = msg.message_type === 'channel' ? 'channel' : 'private';
  const channelId = channelKind === 'channel'
    ? String(msg.channel_id ?? '')
    : String(msg.author_id);
  if (!channelId) return null;

  const textParts: string[] = [];
  for (const seg of msg.message ?? []) {
    if (seg.type === 'text' || seg.type === 'markdown') {
      if (seg.text) textParts.push(seg.text);
    }
  }
  const content = textParts.join('') || msg.raw_message || '';
  // kook-client resolves these getters through optional local caches and throws
  // for uncached users/channels. Identity and routing come from the event itself.
  let author: typeof msg.author;
  let channel: typeof msg.channel;
  try { author = msg.author; } catch { /* optional cache enrichment unavailable */ }
  try { channel = msg.channel; } catch { /* optional cache enrichment unavailable */ }

  return {
    id: String(msg.message_id),
    content,
    channelKind,
    channelId,
    authorId: String(msg.author_id),
    authorName: author?.info?.nickname
      || author?.info?.username
      || String(msg.author_id),
    authorBot: author?.bot === true || author?.info?.bot === true,
    authorRoles: author?.info?.roles ?? author?.roles,
    timestamp: msg.timestamp ?? Date.now(),
    guildId: channel?.info?.guild_id,
    rawMessage: msg.raw_message,
  };
}

export class RuntimeKookClient extends Client {
  readonly #lifecycle: ReturnType<typeof createEndpointLifecycle>;
  #initialized = false;
  #connectionAttempt = 0;
  constructor(config: ConstructorParameters<typeof Client>[0], lifecycleOptions: Parameters<typeof createEndpointLifecycle>[0] = { name: 'kook' }, apiProxy?: KookApiProxy) {
    super({ ...config, autoReconnect: false, handleProcessErrors: false } as ConstructorParameters<typeof Client>[0]);
    this.#lifecycle = createEndpointLifecycle(lifecycleOptions);
    if (apiProxy) {
      this.request.defaults.httpsAgent = createKookApiAgent(apiProxy);
      this.request.defaults.proxy = false;
      this.request.defaults.maxRedirects = 0;
      this.request.interceptors.request.use(request => {
        const target = new URL(request.url ?? '', request.baseURL);
        if (target.protocol !== 'https:' || target.hostname !== 'www.kookapp.cn' || (target.port && target.port !== '443')) {
          throw new EndpointDeliveryError('invalid_destination', 'KOOK API proxy rejected destination identity', 'not_sent');
        }
        return request;
      });
    }
    const transforms = this.request.defaults.transformResponse;
    this.request.defaults.transformResponse = [
      ...(Array.isArray(transforms) ? transforms : transforms ? [transforms] : []),
      (data: unknown, _headers: unknown, status?: number) => {
        // Classify HTTP status before the SDK discards it in its error interceptor.
        if (status !== undefined && status >= 400) {
          const rejected = status < 500 && status !== 408;
          throw new EndpointDeliveryError(rejected ? 'platform_rejected' : 'delivery_unconfirmed',
            `KOOK HTTP request failed (status=${status})`, rejected ? 'rejected' : 'unknown');
        }
        return data;
      },
    ];
    this.request.interceptors.response.use(response => {
      // kook-client unwraps HTTP JSON but does not reject nonzero platform codes.
      const body = response as unknown as { code?: unknown };
      if (typeof body.code === 'number' && body.code !== 0) {
        throw new EndpointDeliveryError('platform_rejected', `KOOK rejected API request (code=${body.code})`, 'rejected');
      }
      return response;
    });
  }
  async connect(): Promise<void> {
    await this.#lifecycle.start(async handle => {
      const attempt = ++this.#connectionAttempt;
      const receiver = this.receiver;
      let active = true;
      const disconnected = () => { if (!active) return; active = false; receiver.off('disconnected', disconnected); handle.notifyClosed('KOOK receiver disconnected'); };
      receiver.on('disconnected', disconnected);
      handle.onForceClose(() => { active = false; receiver.off('disconnected', disconnected); if (attempt === this.#connectionAttempt) void receiver.disconnect(); });
      try {
        const resume = receiver instanceof WebsocketReceiver && (receiver as unknown as { canResume(): boolean }).canResume();
        await (receiver as WebsocketReceiver).connect(resume);
        if (!active || attempt !== this.#connectionAttempt) throw new Error('KOOK connection closed before admission');
        if (!resume || !this.#initialized) { await this.init(); this.#initialized = true; }
      }
      catch (error) { active = false; receiver.off('disconnected', disconnected); if (attempt === this.#connectionAttempt) await receiver.disconnect(); throw error; }
    });
  }
  async disconnect(): Promise<void> { await this.#lifecycle.stop(); }
  /** Native FormData avoids kook-client's Buffer-to-text multipart conversion. */
  async uploadMedia(data: Buffer | string): Promise<string> {
    let bytes: Buffer;
    if (Buffer.isBuffer(data)) bytes = data;
    else if (/^https?:\/\//.test(data)) {
      const downloaded = await fetch(data, { signal: AbortSignal.timeout(30_000) });
      if (!downloaded.ok) throw new EndpointDeliveryError('media_download_failed', 'KOOK source download failed', 'rejected');
      bytes = Buffer.from(await downloaded.arrayBuffer());
    } else if (/^data:[^,]*;base64,/.test(data) || data.startsWith('base64://')) {
      bytes = Buffer.from(data.replace(/^data:[^,]*,|^base64:\/\//, ''), 'base64');
    } else bytes = await readFile(data.replace(/^file:\/\//, ''));
    const form = new FormData();
    form.append('file', new Blob([Uint8Array.from(bytes)]), 'image.png');
    const response = await fetch('https://www.kookapp.cn/api/v3/asset/create', {
      method: 'POST', headers: { Authorization: `Bot ${this.config.token}` }, body: form,
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.json() as { code?: number; data?: { url?: string } };
    if (!response.ok || body.code !== 0) {
      const rejected = response.status >= 400 && response.status < 500 && response.status !== 408 || response.ok && typeof body.code === 'number' && body.code !== 0;
      throw new EndpointDeliveryError(rejected ? 'platform_rejected' : 'delivery_unconfirmed',
        `KOOK upload failed (status=${response.status}, code=${typeof body.code === 'number' ? body.code : 'missing'})`, rejected ? 'rejected' : 'unknown');
    }
    if (typeof body.data?.url !== 'string') throw new EndpointDeliveryError('delivery_unconfirmed', 'KOOK upload returned no URL', 'unknown');
    return body.data.url;
  }

  #preloading = false;

  getTransportState(): EndpointTransportState | undefined {
    if (!(this.receiver instanceof WebsocketReceiver)) return undefined;
    return this.#lifecycle.state;

  }

  async init() {
    this.#preloading = true;
    try { return await super.init(); }
    finally { this.#preloading = false; }
  }

  async getBlacklist(guildId: string) {
    try { return await super.getBlacklist(guildId); }
    catch (error) {
      // kook-client 1.0.4 discards structured HTTP metadata in its interceptor.
      // Match only its exact blacklist permission-denial prefix during preload.
      if (this.#preloading && error instanceof Error
        && (error.message.startsWith('request "/v3/blacklist/list" error with code(403):')
          || error instanceof EndpointDeliveryError && error.code === 'platform_rejected'
          && error.disposition === 'rejected' && error.message === 'KOOK HTTP request failed (status=403)')) {
        this.logger.warn('启动预加载跳过黑名单：缺少管理权限；消息收发继续。');
        return [];
      }
      throw error;
    }
  }
}

export function defaultCreateClient(config: ResolvedKookWebsocketConfig): KookClientTransport {
  return new RuntimeKookClient({
    token: config.token,
    mode: 'websocket',
    socketFactory: (url: string) => createKookStreamSocket(url, config.streamProxy),
    data_dir: config.data_dir || path.join(process.cwd(), 'data', 'kook'),
    timeout: config.timeout,
    max_retry: config.max_retry,
    ignore: config.ignore,
    logLevel: config.logLevel,
  } as ConstructorParameters<typeof RuntimeKookClient>[0], undefined, config.apiProxy) as unknown as KookClientTransport;
}

export function defaultCreateWebhookClient(config: ResolvedKookWebhookConfig): KookClientTransport {
  return new RuntimeKookClient({
    token: config.token,
    mode: 'webhook',
    data_dir: path.join(process.cwd(), 'data', 'kook'),
    timeout: 10_000,
    max_retry: 3,
    ignore: config.ignore,
    logLevel: config.logLevel,
  } as ConstructorParameters<typeof RuntimeKookClient>[0], undefined, config.apiProxy) as unknown as KookClientTransport;
}
