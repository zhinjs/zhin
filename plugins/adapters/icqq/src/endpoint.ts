/**
 * IcqqIpcEndpoint — lifecycle, outbound, IPC subscribe/admit for ICQQ daemon.
 */
import type { EndpointInstance, EndpointManagement } from '@zhin.js/adapter';
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
  buildIcqqInboxNoticeRow,
  buildIcqqInboxRequestRow,
  buildIcqqSystemRequestRow,
  isIcqqNoticePayload,
  isIcqqRequestPayload,
} from './icqq-inbox.js';
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
import type { IpcFriendInfo, IpcGroupInfo, IpcMemberInfo, IpcSystemMessage } from './types.js';

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

/**
 * 收件箱写/推钩子（由装配层注入，见 adapters/icqq.ts）。
 * record* 写 unified_inbox_request/notice；publish 向 console hub 推送实时事件。
 */
export interface IcqqInboxHooks {
  recordRequest(row: Record<string, unknown>): void | Promise<void>;
  recordNotice(row: Record<string, unknown>): void | Promise<void>;
  publish?(type: string, data: unknown): void;
}

export interface IcqqEndpointOptions {
  readonly id: CapabilityId;
  readonly gateway: MessageGateway;
  readonly config: ResolvedIcqqConfig;
  readonly createIpc?: CreateIcqqIpc;
  /** 未注入时 request/notice 事件仅按非消息载荷忽略（不报错）。 */
  readonly inbox?: IcqqInboxHooks;
}

export class IcqqIpcEndpoint implements EndpointInstance {
  readonly #options: IcqqEndpointOptions;
  readonly #createIpc: CreateIcqqIpc;
  readonly name: string;
  /** Populated after start(); agent tools read this. */
  ipc!: IcqqIpcTransport;
  readonly friends = new Map<number, IpcFriendInfo>();
  readonly groups = new Map<number, IpcGroupInfo>();
  readonly management: EndpointManagement = Object.freeze<EndpointManagement>({
    listFriends: () => this.getFriendList(),
    listGroups: () => this.getGroupList(),
    listGroupMembers: (groupId) => this.getGroupMemberList(groupId),
    approveRequest: (requestId, remark) => this.approveRequest(requestId, remark),
    rejectRequest: (requestId, reason) => this.rejectRequest(requestId, reason),
    kickGroupMember: (groupId, userId) => this.removeMember(groupId, userId),
    muteGroupMember: (groupId, userId, duration) => this.muteMember(groupId, userId, duration),
    setGroupAdmin: (groupId, userId, enabled) => this.setModerator(groupId, userId, enabled),
    deleteFriend: (userId) => this.deleteFriend(userId),
  });
  #open = false;
  #started = false;
  #subscriptions: Array<{ unsubscribe: () => Promise<void> }> = [];
  #inboundDeduper = new InboundMessageDeduper();
  /** request/notice 去重（推送事件与 GET_SYSTEM_MSG 首拉可能重复同一 flag）。 */
  #inboxDeduper = new InboundMessageDeduper();
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
    // daemon 推送 client.em 全部事件，request/notice 实时到达；
    // 启动时补一次 GET_SYSTEM_MSG，捞离线期间积存的待处理请求。
    void this.#pullPendingSystemMessages();
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
    this.#inboxDeduper.clear();
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

  // ── 社交/群管（Console endpoint RPC 探测面）────────────────────────
  // console-rpc-extended.ts 按方法名探测这些接口；全部薄封装走 IPC daemon。

  /** Console endpoint:friends —— 好友列表（LIST_FRIENDS，归一为 {user_id, nickname, remark}）。 */
  async getFriendList(): Promise<Array<{ user_id: number; nickname: string; remark: string }>> {
    const resp = await this.#mustRequest(Actions.LIST_FRIENDS, undefined, '获取好友列表');
    const list = Array.isArray(resp.data) ? (resp.data as IpcFriendInfo[]) : [];
    return list.map((f) => ({
      user_id: f.user_id,
      nickname: f.nickname,
      remark: f.remark ?? '',
    }));
  }

  /** Console endpoint:groups —— 群列表（LIST_GROUPS，归一为 {group_id, name}）。 */
  async getGroupList(): Promise<Array<{ group_id: number; name: string }>> {
    const resp = await this.#mustRequest(Actions.LIST_GROUPS, undefined, '获取群列表');
    const list = Array.isArray(resp.data) ? (resp.data as IpcGroupInfo[]) : [];
    return list.map((g) => ({
      group_id: g.group_id,
      name: g.group_name,
    }));
  }

  /** Console endpoint:groupMembers —— 群成员列表（LIST_GROUP_MEMBERS，字段对齐 daemon 返回）。 */
  async getGroupMemberList(groupId: number | string): Promise<IpcMemberInfo[]> {
    const resp = await this.#mustRequest(
      Actions.LIST_GROUP_MEMBERS,
      { group_id: toNumericId(groupId, 'group_id') },
      '获取群成员列表',
    );
    return Array.isArray(resp.data) ? (resp.data as IpcMemberInfo[]) : [];
  }

  /** getGroupMemberList 别名（console 探测 listMembers / getMemberList）。 */
  listMembers(groupId: number | string): Promise<IpcMemberInfo[]> {
    return this.getGroupMemberList(groupId);
  }

  getMemberList(groupId: number | string): Promise<IpcMemberInfo[]> {
    return this.getGroupMemberList(groupId);
  }

  /**
   * Console endpoint:requestApprove —— id 为 console inbox 行的 platform_request_id。
   * 先 GET_SYSTEM_MSG 按 flag（回退 seq）定位请求，再按类型路由 handle_friend/group_request。
   */
  async approveRequest(id: string, remark?: string): Promise<void> {
    await this.#handleSystemRequest(id, true, { remark });
  }

  async rejectRequest(id: string, reason?: string): Promise<void> {
    await this.#handleSystemRequest(id, false, { reason });
  }

  /** Console endpoint:deleteFriend —— FRIEND_DELETE。 */
  async deleteFriend(userId: number | string): Promise<void> {
    await this.#mustRequest(
      Actions.FRIEND_DELETE,
      { user_id: toNumericId(userId, 'user_id') },
      '删除好友',
    );
  }

  /** deleteFriend 别名（console 探测 delete_friend）。 */
  delete_friend(userId: number | string): Promise<void> {
    return this.deleteFriend(userId);
  }

  /** Console endpoint:groupKick —— GROUP_KICK。 */
  async removeMember(groupId: number | string, userId: number | string): Promise<void> {
    await this.#mustRequest(
      Actions.GROUP_KICK,
      { group_id: toNumericId(groupId, 'group_id'), user_id: toNumericId(userId, 'user_id') },
      '踢出群成员',
    );
  }

  kickMember(groupId: number | string, userId: number | string): Promise<void> {
    return this.removeMember(groupId, userId);
  }

  setGroupKick(groupId: number | string, userId: number | string): Promise<void> {
    return this.removeMember(groupId, userId);
  }

  /** Console endpoint:groupMute —— GROUP_MUTE（duration 秒，默认 600）。 */
  async muteMember(groupId: number | string, userId: number | string, duration = 600): Promise<void> {
    await this.#mustRequest(
      Actions.GROUP_MUTE,
      {
        group_id: toNumericId(groupId, 'group_id'),
        user_id: toNumericId(userId, 'user_id'),
        duration,
      },
      '禁言群成员',
    );
  }

  banMember(groupId: number | string, userId: number | string, duration = 600): Promise<void> {
    return this.muteMember(groupId, userId, duration);
  }

  setGroupMute(groupId: number | string, userId: number | string, duration = 600): Promise<void> {
    return this.muteMember(groupId, userId, duration);
  }

  /** Console endpoint:groupAdmin —— SET_GROUP_ADMIN（enable 默认 true）。 */
  async setModerator(groupId: number | string, userId: number | string, enable = true): Promise<void> {
    await this.#mustRequest(
      Actions.SET_GROUP_ADMIN,
      {
        group_id: toNumericId(groupId, 'group_id'),
        user_id: toNumericId(userId, 'user_id'),
        enable,
      },
      '设置群管理员',
    );
  }

  setAdmin(groupId: number | string, userId: number | string, enable = true): Promise<void> {
    return this.setModerator(groupId, userId, enable);
  }

  setGroupAdmin(groupId: number | string, userId: number | string, enable = true): Promise<void> {
    return this.setModerator(groupId, userId, enable);
  }

  /** IPC 请求并统一错误上下文：daemon 返回 ok=false 时抛出带操作名的错误。 */
  async #mustRequest(
    action: string,
    params: Record<string, unknown> | undefined,
    label: string,
  ): Promise<IpcResponse> {
    const resp = await this.request(action, params);
    if (!resp.ok) {
      throw new Error(`icqq ${label}失败: ${resp.error ?? 'daemon 未返回错误详情'}`);
    }
    return resp;
  }

  /** 按 flag/seq 在 GET_SYSTEM_MSG 中定位请求，路由到好友/群请求处理 action。 */
  async #handleSystemRequest(
    id: string,
    approve: boolean,
    extra: { remark?: string; reason?: string },
  ): Promise<void> {
    const resp = await this.#mustRequest(Actions.GET_SYSTEM_MSG, undefined, '获取待处理请求');
    const data = resp.data as
      | { friendRequests?: unknown; groupRequests?: unknown }
      | undefined;
    const friendRequests = Array.isArray(data?.friendRequests)
      ? (data.friendRequests as IpcSystemMessage[])
      : [];
    const groupRequests = Array.isArray(data?.groupRequests)
      ? (data.groupRequests as IpcSystemMessage[])
      : [];
    const matches = (m: IpcSystemMessage): boolean =>
      m.flag === id || (m.seq != null && String(m.seq) === id);
    const friend = friendRequests.find(matches);
    const group = friend ? undefined : groupRequests.find(matches);
    const target = friend ?? group;
    if (!target?.flag) {
      throw new Error(`icqq 未找到待处理请求: ${id}（GET_SYSTEM_MSG 中无匹配 flag/seq）`);
    }
    const params: Record<string, unknown> = { flag: target.flag, approve };
    if (friend) {
      if (extra.remark) params.remark = extra.remark;
      await this.#mustRequest(Actions.HANDLE_FRIEND_REQUEST, params, '处理好友请求');
    } else {
      if (extra.reason) params.reason = extra.reason;
      await this.#mustRequest(Actions.HANDLE_GROUP_REQUEST, params, '处理群请求');
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
    if (isIcqqRequestPayload(payload)) {
      this.#recordInboxRequest(payload as Record<string, unknown>);
      return;
    }
    if (isIcqqNoticePayload(payload)) {
      this.#recordInboxNotice(payload as Record<string, unknown>);
      return;
    }
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

  /** 收件箱行公共前缀：adapter 槽 localName + endpoint live 名（uin）。 */
  #inboxBase(): { adapter: string; endpointId: string } {
    const id = String(this.#options.id);
    return { adapter: id.split('\0').pop() ?? id, endpointId: this.name };
  }

  #recordInboxRequest(payload: Record<string, unknown>): void {
    const hooks = this.#options.inbox;
    if (!hooks) return;
    const row = buildIcqqInboxRequestRow(payload, this.#inboxBase());
    if (!row) return;
    if (!this.#inboxDeduper.shouldProcess(`request:${String(row.platform_request_id)}`)) return;
    void hooks.recordRequest(row);
    hooks.publish?.('endpoint:request', row);
  }

  #recordInboxNotice(payload: Record<string, unknown>): void {
    const hooks = this.#options.inbox;
    if (!hooks) return;
    const row = buildIcqqInboxNoticeRow(payload, this.#inboxBase());
    if (!row) return;
    if (!this.#inboxDeduper.shouldProcess(`notice:${String(row.platform_notice_id)}`)) return;
    void hooks.recordNotice(row);
    hooks.publish?.('endpoint:notice', row);
  }

  /** 启动/重连后首拉 GET_SYSTEM_MSG：补录离线期间的好友/群待处理请求。 */
  async #pullPendingSystemMessages(): Promise<void> {
    const hooks = this.#options.inbox;
    if (!hooks || !this.ipc) return;
    try {
      const resp = await this.ipc.request(Actions.GET_SYSTEM_MSG);
      if (!resp.ok) return;
      const data = resp.data as
        | { friendRequests?: unknown; groupRequests?: unknown }
        | undefined;
      const base = this.#inboxBase();
      const rows = [
        ...(Array.isArray(data?.friendRequests)
          ? (data.friendRequests as IpcSystemMessage[]).map((m) =>
            buildIcqqSystemRequestRow(m, 'friend', base))
          : []),
        ...(Array.isArray(data?.groupRequests)
          ? (data.groupRequests as IpcSystemMessage[]).map((m) =>
            buildIcqqSystemRequestRow(m, 'group', base))
          : []),
      ];
      for (const row of rows) {
        if (!row) continue;
        if (!this.#inboxDeduper.shouldProcess(`request:${String(row.platform_request_id)}`)) continue;
        void hooks.recordRequest(row);
        hooks.publish?.('endpoint:request', row);
      }
    } catch (error) {
      logger.debug(formatCompact({
        op: 'inbox_pull_system_msg',
        endpoint: this.name,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
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

/** console RPC 传入的 gid/uid 可能是字符串，统一收敛为数字。 */
function toNumericId(value: number | string, label: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || String(value).trim() === '') {
    throw new TypeError(`icqq ${label} 必须是数字: ${String(value)}`);
  }
  return n;
}

async function defaultCreateIpc(config: ResolvedIcqqConfig): Promise<IcqqIpcTransport> {
  const uin = Number(config.name);
  if (config.rpc) {
    return IpcClient.connectRpc(config.rpc);
  }
  return IpcClient.connect(uin);
}
