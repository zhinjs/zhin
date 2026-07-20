/**
 * IcqqIpcEndpoint — lifecycle, outbound, IPC subscribe/admit for ICQQ daemon.
 */
import type { EndpointInstance } from '@zhin.js/adapter';
import type { MessageGateway } from '@zhin.js/core/runtime';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { CapabilityId } from '@zhin.js/plugin-runtime';
import { registerIcqqAgentEndpoint } from './icqq-agent-deps.js';
import {
  InboundMessageDeduper,
  findIcqqNestedMessageSource,
  isIcqqBotMentioned,
  isIcqqMessagePostType,
  normalizeIcqqInboundMessage,
  quotedPayloadFromIcqqSource,
  resolveIcqqQuoteIdFromEvent,
  shouldSkipSelfInboundMessage,
  unwrapIcqqIpcEventPayload,
  type IcqqIpcMessageEvent,
} from './icqq-inbound.js';
import {
  isIcqqGuildIpcEvent,
  normalizeIcqqGuildInboundMessage,
} from './icqq-guild.js';
import { IpcClient } from './ipc-client.js';
import {
  materializeOutboundBase64,
  resolveIcqqOutboundMediaMode,
} from './outbound-media.js';
import {
  Actions,
  formatInboundContent,
  formatInboundTarget,
  formatOutboundBody,
  parseSendTarget,
  type IcqqInboundMessage,
  type IpcEvent,
  type IpcResponse,
  type ResolvedIcqqConfig,
} from './protocol.js';
import type { IpcFriendInfo, IpcGroupInfo } from './types.js';

const logger = getLogger('icqq');

/** Minimal IPC surface used by the endpoint (real IpcClient or test mock). */
export interface IcqqIpcTransport {
  request(action: string, params?: Record<string, unknown>): Promise<IpcResponse>;
  subscribe(
    action: string,
    params: Record<string, unknown>,
    handler: (event: IpcEvent) => void,
  ): { unsubscribe: () => Promise<void> };
  setOnRemoteDisconnect(handler: (() => void) | null): void;
  close(): void;
}

export type CreateIcqqIpc = (config: ResolvedIcqqConfig) => Promise<IcqqIpcTransport>;

export interface IcqqEndpointOptions {
  readonly id: CapabilityId;
  readonly gateway: MessageGateway;
  readonly config: ResolvedIcqqConfig;
  readonly createIpc?: CreateIcqqIpc;
}

export class IcqqIpcEndpoint implements EndpointInstance {
  readonly #options: IcqqEndpointOptions;
  readonly #createIpc: CreateIcqqIpc;
  readonly name: string;
  /** Populated after start(); agent tools read this. */
  ipc!: IcqqIpcTransport;
  readonly friends = new Map<number, IpcFriendInfo>();
  readonly groups = new Map<number, IpcGroupInfo>();
  #open = false;
  #started = false;
  #subscriptions: Array<{ unsubscribe: () => Promise<void> }> = [];
  #inboundDeduper = new InboundMessageDeduper();
  #unregisterAgent?: () => void;
  /** 用户主动 stop 时为 true，阻止自动重连 */
  #intentionalDisconnect = false;
  /** 是否已有重连循环在跑（避免多次 schedule 叠套） */
  #reconnectRunning = false;

  constructor(options: IcqqEndpointOptions) {
    this.#options = options;
    this.name = options.config.name;
    this.#createIpc = options.createIpc ?? defaultCreateIpc;
  }

  async request(action: string, params?: Record<string, unknown>): Promise<IpcResponse> {
    if (!this.ipc) {
      throw new Error(`icqq endpoint ${this.name} 未连接（IPC 未初始化或已停止），无法发起请求: ${action}`);
    }
    return this.ipc.request(action, params);
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    this.#intentionalDisconnect = false;
    try {
      await this.#bindIpcSession();
      this.#unregisterAgent = registerIcqqAgentEndpoint(this.name, this);
      logger.info(formatCompact({
        op: 'connect',
        endpoint: this.name,
        mode: this.#options.config.rpc ? 'rpc' : 'ipc',
        friends: this.friends.size,
        groups: this.groups.size,
      }));
    } catch (error) {
      await this.stop();
      // Startup connect failures are surfaced once (with stack) by AdapterIndex;
      // keep this at debug to avoid a duplicate error-level log.
      logger.debug(`Failed to connect ICQQ IPC: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      throw error;
    }
  }

  /** 建立或恢复与守护进程的 IPC/RPC 会话（订阅、缓存列表） */
  async #bindIpcSession(): Promise<void> {
    // 旧连接上的订阅句柄已失效，不再对死 socket 发 unsubscribe
    this.#subscriptions = [];
    this.ipc = await this.#createIpc(this.#options.config);
    if (this.#options.config.autoReconnect !== false) {
      this.ipc.setOnRemoteDisconnect(() => this.#scheduleReconnect());
    }
    await this.#refreshLists();
    const sub = this.ipc.subscribe(Actions.SUBSCRIBE, {}, (event) => {
      this.#handleEvent(event);
    });
    this.#subscriptions.push(sub);
  }

  /** IPC/RPC 意外断开时调度重连（指数退避） */
  #scheduleReconnect(): void {
    if (this.#options.config.autoReconnect === false) return;
    if (this.#intentionalDisconnect) return;
    if (this.#reconnectRunning) return;
    this.#reconnectRunning = true;
    void this.#runReconnectLoop();
  }

  async #runReconnectLoop(): Promise<void> {
    try {
      for (let attempt = 0; !this.#intentionalDisconnect; attempt++) {
        const base = Math.min(30_000, 500 * 2 ** Math.min(attempt, 6));
        const jitter = Math.floor(Math.random() * 400);
        const delayMs = base + jitter;
        // 首次断开 WARN，后续重试静默为 DEBUG，避免刷屏
        const disconnectLog = attempt === 0 ? logger.warn.bind(logger) : logger.debug.bind(logger);
        disconnectLog(formatCompact({
          op: 'disconnect',
          endpoint: this.name,
          ok: false,
          delay_ms: delayMs,
          attempt: attempt + 1,
        }));
        await new Promise<void>((r) => setTimeout(r, delayMs));
        if (this.#intentionalDisconnect) break;
        try {
          await this.#bindIpcSession();
          logger.info(formatCompact({
            op: 'reconnect',
            endpoint: this.name,
            ok: true,
            attempts: attempt + 1,
            friends: this.friends.size,
            groups: this.groups.size,
          }));
          break;
        } catch (error) {
          const retryLog = attempt === 0 ? logger.warn.bind(logger) : logger.debug.bind(logger);
          retryLog(formatCompact({
            op: 'reconnect',
            endpoint: this.name,
            ok: false,
            attempt: attempt + 1,
            error: error instanceof Error ? error.message : String(error),
          }));
        }
      }
    } finally {
      this.#reconnectRunning = false;
    }
  }

  open(): void {
    this.#open = true;
  }

  close(): void {
    this.#open = false;
  }

  async stop(): Promise<void> {
    this.#intentionalDisconnect = true;
    this.#open = false;
    this.ipc?.setOnRemoteDisconnect(null);
    for (const sub of this.#subscriptions.splice(0)) {
      await sub.unsubscribe().catch(() => { /* ignore */ });
    }
    this.#unregisterAgent?.();
    this.#unregisterAgent = undefined;
    this.#inboundDeduper.clear();
    this.friends.clear();
    this.groups.clear();
    try {
      this.ipc?.close();
    } catch {
      /* ignore */
    }
    // 置空 ipc：start 前 / stop 后的 request() 走防御性报错而非 TypeError
    this.ipc = undefined as unknown as IcqqIpcTransport;
    this.#started = false;
    logger.debug(formatCompact({ op: 'disconnect', endpoint: this.name }));
  }

  async send({ target, payload }: { readonly target: string; readonly payload: unknown }): Promise<string> {
    if (!this.ipc) {
      throw new Error(`icqq endpoint ${this.name} 未连接（IPC 未初始化或已停止），无法发送消息`);
    }
    const mediaMode = resolveIcqqOutboundMediaMode(this.#options.config);
    const content = Array.isArray(payload)
      ? materializeOutboundBase64(payload, mediaMode)
      : payload;
    const message = formatOutboundBody(content);
    const parsed = parseSendTarget(target);
    let action: string;
    let params: Record<string, unknown>;
    switch (parsed.kind) {
      case 'private':
        action = Actions.SEND_PRIVATE_MSG;
        params = { user_id: parsed.userId, message };
        break;
      case 'group':
        action = Actions.SEND_GROUP_MSG;
        params = { group_id: parsed.groupId, message };
        break;
      case 'temp':
        action = Actions.SEND_TEMP_MSG;
        params = {
          group_id: parsed.groupId,
          user_id: parsed.userId,
          message,
        };
        break;
      case 'channel':
        action = Actions.GUILD_SEND_MSG;
        params = {
          guild_id: parsed.guildId,
          channel_id: parsed.channelId,
          message,
        };
        break;
    }
    const resp = await this.ipc.request(action, params);
    if (!resp.ok) {
      throw new Error(`发送消息失败: ${resp.error}`);
    }
    const messageId = String(
      (resp.data as { message_id?: unknown } | undefined)?.message_id ?? `sent_${Date.now()}`,
    );
    logger.debug(formatCompact({
      op: 'icqq_send',
      endpoint: this.name,
      target,
      messageId,
    }));
    return messageId;
  }

  // ── 消息回应（activity-feedback / typing reaction）────────────────────

  private static readonly EMOJI_MAP: Record<string, string> = {
    '⏳': '1468368274',
    '👍': '128077',
    '❤️': '10084',
    '😊': '128522',
    '🎉': '127881',
    '🔥': '128293',
    '✅': '9989',
    '❌': '10060',
    '⭐': '11088',
    '💯': '128175',
  };

  private getEmojiId(emoji: string): string {
    if (/^\d+$/u.test(emoji)) return emoji;
    return IcqqIpcEndpoint.EMOJI_MAP[emoji] ?? String(emoji.codePointAt(0) || 0);
  }

  /** Activity-feedback / OutboundHost reaction surface. */
  async addReaction(messageId: string, emoji: string): Promise<string | null> {
    try {
      const emojiId = this.getEmojiId(emoji);
      const resp = await this.request(Actions.GROUP_SET_REACTION, {
        message_id: messageId,
        id: emojiId,
      });
      if (!resp.ok) {
        logger.warn(formatCompact({
          op: 'add_reaction',
          endpoint: this.name,
          message_id: messageId,
          emoji,
          id: emojiId,
          ok: false,
          error: resp.error,
        }));
        return null;
      }
      logger.debug(formatCompact({
        op: 'add_reaction',
        endpoint: this.name,
        message_id: messageId,
        emoji,
        id: emojiId,
        ok: true,
      }));
      return emojiId;
    } catch (error) {
      logger.warn(formatCompact({
        op: 'add_reaction',
        endpoint: this.name,
        message_id: messageId,
        emoji,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }));
      return null;
    }
  }

  async removeReaction(messageId: string, reactionId: string): Promise<void> {
    try {
      const parts = reactionId.split('_');
      const emojiId = parts.length >= 2 ? parts[1]! : reactionId;
      const resp = await this.request(Actions.GROUP_DEL_REACTION, {
        message_id: messageId,
        id: emojiId,
      });
      if (!resp.ok) {
        logger.warn(formatCompact({
          op: 'remove_reaction',
          endpoint: this.name,
          message_id: messageId,
          reaction_id: reactionId,
          id: emojiId,
          ok: false,
          error: resp.error,
        }));
        return;
      }
      logger.debug(formatCompact({
        op: 'remove_reaction',
        endpoint: this.name,
        message_id: messageId,
        reaction_id: reactionId,
        id: emojiId,
        ok: true,
      }));
    } catch (error) {
      logger.warn(formatCompact({
        op: 'remove_reaction',
        endpoint: this.name,
        message_id: messageId,
        reaction_id: reactionId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  /** Activity-feedback autoRemove / Console recall. */
  async recallMessage(messageId: string): Promise<void> {
    if (!messageId || messageId.startsWith('outbound:')) return;
    try {
      const resp = await this.request(Actions.RECALL_MSG, { message_id: messageId });
      if (!resp.ok) {
        logger.warn(formatCompact({
          op: 'recall_message',
          endpoint: this.name,
          message_id: messageId,
          ok: false,
          error: resp.error,
        }));
        return;
      }
      logger.debug(formatCompact({
        op: 'recall_message',
        endpoint: this.name,
        message_id: messageId,
        ok: true,
      }));
    } catch (error) {
      logger.warn(formatCompact({
        op: 'recall_message',
        endpoint: this.name,
        message_id: messageId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  /** Test / internal: admit when open. */
  admit(msg: IcqqInboundMessage): void {
    if (!this.#open) return;
    // 新 Runtime Message.content 为纯文本：@ 本机（uin = name）只能经 metadata 传递
    const mentioned = isIcqqBotMentioned({ uin: this.name, rawMessage: msg.content });
    void this.#options.gateway.receive({
      adapter: this.#options.id,
      target: msg.target,
      content: msg.content,
      sender: msg.sender,
      id: msg.id,
      metadata: Object.freeze({
        endpoint: this.name,
        channelType: msg.channelType,
        ...msg.metadata,
        ...(mentioned ? { mentioned: true } : {}),
      }),
    }).catch((err) => {
      logger.warn(formatCompact({
        op: 'icqq_gateway_receive_failed',
        target: msg.target,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  async #refreshLists(): Promise<void> {
    const [flResp, glResp] = await Promise.all([
      this.ipc.request(Actions.LIST_FRIENDS),
      this.ipc.request(Actions.LIST_GROUPS),
    ]);
    this.friends.clear();
    if (flResp.ok && Array.isArray(flResp.data)) {
      for (const f of flResp.data as IpcFriendInfo[]) {
        this.friends.set(f.user_id, f);
      }
    }
    this.groups.clear();
    if (glResp.ok && Array.isArray(glResp.data)) {
      for (const g of glResp.data as IpcGroupInfo[]) {
        this.groups.set(g.group_id, g);
      }
    }
  }

  #handleEvent(event: IpcEvent): void {
    if (isIcqqGuildIpcEvent(event.event)) {
      this.#handleGuildEvent(event);
      return;
    }
    const payload = unwrapIcqqIpcEventPayload(event);
    if (!payload || typeof payload !== 'object') return;
    if (!isIcqqMessagePostType(payload)) return;
    const data = payload as IcqqIpcMessageEvent;
    if (shouldSkipSelfInboundMessage(data)) return;
    const normalized = normalizeIcqqInboundMessage(data);
    if (!normalized) return;
    if (!this.#inboundDeduper.shouldProcess(normalized.messageId)) return;
    this.admit({
      id: normalized.messageId,
      target: formatInboundTarget({
        channelType: normalized.channelType,
        channelId: normalized.channelId,
        channelParentGroupId: normalized.channelParentGroupId,
      }),
      content: formatInboundContent(normalized.rawMessage),
      sender: normalized.userId,
      channelType: normalized.channelType,
      metadata: buildIcqqQuoteMetadata(data, {
        nickname: normalized.nickname,
        senderRole: normalized.senderRole,
      }),
    });
  }

  #handleGuildEvent(event: IpcEvent): void {
    const payload = event.data;
    if (!payload || typeof payload !== 'object') return;
    const normalized = normalizeIcqqGuildInboundMessage(
      payload as Parameters<typeof normalizeIcqqGuildInboundMessage>[0],
    );
    if (!normalized) return;
    if (!this.#inboundDeduper.shouldProcess(`guild:${normalized.messageId}`)) return;
    this.admit({
      id: normalized.messageId,
      target: formatInboundTarget({
        channelType: 'channel',
        channelId: normalized.channelId,
        guildId: normalized.guildId,
      }),
      content: formatInboundContent(normalized.rawMessage),
      sender: normalized.userId,
      channelType: 'channel',
      metadata: {
        guildId: normalized.guildId,
        nickname: normalized.nickname,
      },
    });
  }
}

/**
 * 组装入站 metadata：在基础字段上补充 quote 链路信息。
 * - quote_id：被引用消息 id（resolveIcqqQuoteIdFromEvent，无则不写）
 * - quote_sender_id / quote_sender_name / quote_content：source 可用时的平铺摘要
 */
function buildIcqqQuoteMetadata(
  data: IcqqIpcMessageEvent,
  base: Record<string, unknown>,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = { ...base };
  const quoteId = resolveIcqqQuoteIdFromEvent(data);
  if (quoteId) metadata.quote_id = quoteId;
  const quoted = quotedPayloadFromIcqqSource(findIcqqNestedMessageSource(data));
  if (quoted?.sender?.id) metadata.quote_sender_id = quoted.sender.id;
  if (quoted?.sender?.name) metadata.quote_sender_name = quoted.sender.name;
  const quoteText = quoted
    ? (typeof quoted.content === 'string'
        ? quoted.content
        : quoted.content
            .map((seg) =>
              seg && typeof seg === 'object' && seg.type === 'text'
                ? String((seg.data as { text?: unknown } | undefined)?.text ?? '')
                : '',
            )
            .join('')
      ).trim() || quoted.raw || ''
    : '';
  if (quoteText) metadata.quote_content = quoteText;
  return metadata;
}

async function defaultCreateIpc(config: ResolvedIcqqConfig): Promise<IcqqIpcTransport> {
  const uin = Number(config.name);
  if (config.rpc) {
    return IpcClient.connectRpc(config.rpc);
  }
  return IpcClient.connect(uin);
}
