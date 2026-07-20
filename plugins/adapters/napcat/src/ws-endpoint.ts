/**
 * NapCat WS client endpoint — outbound connect to NapCat.
 */
import WebSocket from 'ws';
import { clearInterval, clearTimeout, setTimeout } from 'node:timers';
import type { EndpointInstance } from '@zhin.js/adapter';
import type { MessageGateway } from '@zhin.js/core/runtime';
import { formatCompact, getLogger } from '@zhin.js/logger';
import type { CapabilityId } from '@zhin.js/plugin-runtime';
import { registerNapcatAgentEndpoint } from './napcat-agent-deps.js';
import {
  InboundMessageDeduper,
  isNapCatBotMentioned,
  isSelfMessage,
  normalizeMessage,
} from './napcat-inbound.js';
import {
  buildSendAction,
  buildWsConnectOptions,
  formatInboundContent,
  formatInboundTarget,
  formatOutboundSegments,
  isMessageEvent,
  senderNickname,
  senderUserId,
  type NapCatEvent,
  type NapCatWsConfig,
} from './protocol.js';
import {
  callNapCatWsAction,
  handleNapCatWsMessage,
  rejectAllPending,
  startNapCatHeartbeat,
} from './ws-transport.js';
import {
  type NapCatPendingAction,
  type NapCatWsCreateOptions,
  type NapCatWsSocket,
} from './ws-types.js';

const logger = getLogger('napcat');

export interface NapCatWsEndpointOptions {
  readonly id: CapabilityId;
  readonly gateway: MessageGateway;
  readonly config: NapCatWsConfig;
  readonly createWebSocket?: (
    url: string,
    options: NapCatWsCreateOptions,
  ) => NapCatWsSocket;
}

export class NapCatWsEndpoint implements EndpointInstance {
  readonly #options: NapCatWsEndpointOptions;
  readonly #inboundDeduper = new InboundMessageDeduper();
  #ws?: NapCatWsSocket;
  #reconnectTimer?: NodeJS.Timeout;
  #heartbeatTimer?: NodeJS.Timeout;
  #requestId = { value: 0 };
  #pending = new Map<string, NapCatPendingAction>();
  #open = false;
  #started = false;
  #stopping = false;
  #unregisterAgent?: () => void;

  constructor(options: NapCatWsEndpointOptions) {
    this.#options = options;
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    this.#stopping = false;
    this.#unregisterAgent = registerNapcatAgentEndpoint(this.#options.config.name, this);
    try {
      await this.#connect();
    } catch (err) {
      this.#started = false;
      throw err;
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
    this.#stopping = true;
    this.#started = false;
    this.#unregisterAgent?.();
    this.#unregisterAgent = undefined;
    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = undefined;
    }
    if (this.#heartbeatTimer) {
      clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = undefined;
    }
    rejectAllPending(this.#pending);
    this.#inboundDeduper.clear();
    if (this.#ws) {
      try {
        this.#ws.close();
      } catch {
        /* ignore */
      }
      this.#ws = undefined;
    }
    logger.debug(formatCompact({ op: 'disconnect', endpoint: this.#options.config.name }));
  }

  async send({ target, payload }: { readonly target: string; readonly payload: unknown }): Promise<string> {
    const message = formatOutboundSegments(payload);
    const { action, params } = buildSendAction(target, message);
    const data = await this.callApi(action, params) as { message_id?: number | string } | undefined;
    const messageId = data?.message_id != null ? String(data.message_id) : '';
    logger.debug(formatCompact({
      op: 'napcat_send',
      endpoint: this.#options.config.name,
      target,
      messageId,
    }));
    return messageId;
  }

  callApi(action: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return callNapCatWsAction(this.#ws, this.#pending, this.#requestId, action, params);
  }

  // ── Agent-facing API wrappers ─────────────────────────────────────

  async setTitle(groupId: number, userId: number, title: string, duration = -1): Promise<boolean> {
    await this.callApi('set_group_special_title', {
      group_id: groupId,
      user_id: userId,
      special_title: title,
      duration,
    });
    return true;
  }

  sendLike(userId: number, times = 1) {
    return this.callApi('send_like', { user_id: userId, times });
  }

  deleteFriend(userId: number) {
    return this.callApi('delete_friend', { user_id: userId });
  }

  markMsgAsRead(messageId: number) {
    return this.callApi('mark_msg_as_read', { message_id: messageId });
  }

  ocrImage(image: string) {
    return this.callApi('ocr_image', { image });
  }

  setQQProfile(
    nickname: string,
    company?: string,
    email?: string,
    college?: string,
    personalNote?: string,
  ) {
    return this.callApi('set_qq_profile', {
      nickname,
      company,
      email,
      college,
      personal_note: personalNote,
    });
  }

  setGroupPortrait(groupId: number, file: string) {
    return this.callApi('set_group_portrait', { group_id: groupId, file });
  }

  setEssenceMsg(messageId: number) {
    return this.callApi('set_essence_msg', { message_id: messageId });
  }

  deleteEssenceMsg(messageId: number) {
    return this.callApi('delete_essence_msg', { message_id: messageId });
  }

  getEssenceMsgList(groupId: number) {
    return this.callApi('get_essence_msg_list', { group_id: groupId });
  }

  sendGroupSign(groupId: number) {
    return this.callApi('send_group_sign', { group_id: groupId });
  }

  sendGroupNotice(groupId: number, content: string, image?: string) {
    return this.callApi('_send_group_notice', { group_id: groupId, content, image });
  }

  getGroupNotice(groupId: number) {
    return this.callApi('_get_group_notice', { group_id: groupId });
  }

  deleteGroupNotice(groupId: number, noticeId: string) {
    return this.callApi('_del_group_notice', { group_id: groupId, notice_id: noticeId });
  }

  uploadGroupFile(groupId: number, file: string, name: string, folder?: string) {
    return this.callApi('upload_group_file', { group_id: groupId, file, name, folder });
  }

  getGroupRootFiles(groupId: number) {
    return this.callApi('get_group_root_files', { group_id: groupId });
  }

  getGroupFileUrl(groupId: number, fileId: string, busid: number) {
    return this.callApi('get_group_file_url', { group_id: groupId, file_id: fileId, busid });
  }

  downloadFile(url: string, threadCount = 1, headers?: string[]) {
    return this.callApi('download_file', { url, thread_count: threadCount, headers });
  }

  setOnlineStatus(status: number, extStatus: number) {
    return this.callApi('set_online_status', { status, ext_status: extStatus });
  }

  setQQAvatar(file: string) {
    return this.callApi('set_qq_avatar', { file });
  }

  forwardFriendSingleMsg(userId: number, messageId: number) {
    return this.callApi('forward_friend_single_msg', { user_id: userId, message_id: messageId });
  }

  forwardGroupSingleMsg(groupId: number, messageId: number) {
    return this.callApi('forward_group_single_msg', { group_id: groupId, message_id: messageId });
  }

  translateEn2Zh(sourceText: string) {
    return this.callApi('translate_en2zh', { source_text: sourceText });
  }

  setMsgEmojiLike(messageId: number, emojiId: string) {
    return this.callApi('set_msg_emoji_like', { message_id: messageId, emoji_id: emojiId });
  }

  sendForwardMsg(messageType: 'private' | 'group', id: number, messages: unknown[]) {
    return this.callApi('send_forward_msg', {
      message_type: messageType,
      [messageType === 'group' ? 'group_id' : 'user_id']: id,
      messages,
    });
  }

  getFriendMsgHistory(userId: number, messageSeq?: number, count?: number) {
    return this.callApi('get_friend_msg_history', {
      user_id: userId,
      message_seq: messageSeq,
      count,
    });
  }

  getGroupMsgHistory(groupId: number, messageSeq?: number, count?: number) {
    return this.callApi('get_group_msg_history', {
      group_id: groupId,
      message_seq: messageSeq,
      count,
    });
  }

  setSelfLongnick(longnick: string) {
    return this.callApi('set_self_longnick', { longNick: longnick });
  }

  getGroupInfoEx(groupId: number) {
    return this.callApi('get_group_info_ex', { group_id: groupId });
  }

  sendPoke(userId: number, groupId?: number) {
    return this.callApi('send_poke', { user_id: userId, group_id: groupId });
  }

  ncGetUserStatus(userId: number) {
    return this.callApi('nc_get_user_status', { user_id: userId });
  }

  getGroupShutList(groupId: number) {
    return this.callApi('get_group_shut_list', { group_id: groupId });
  }

  getMiniAppArk(type: string, title: string, desc: string, picUrl: string, jumpUrl: string) {
    return this.callApi('get_mini_app_ark', { type, title, desc, picUrl, jumpUrl });
  }

  getAiCharacters(groupId: number) {
    return this.callApi('get_ai_characters', { group_id: groupId });
  }

  sendGroupAiRecord(groupId: number, characterId: string, text: string) {
    return this.callApi('send_group_ai_record', {
      group_id: groupId,
      character: characterId,
      text,
    });
  }

  /** Test / internal: admit a parsed event when the endpoint is open. */
  admit(ev: NapCatEvent): void {
    if (!this.#open || !isMessageEvent(ev)) return;
    if (isSelfMessage(ev)) return;
    const msgId = String(ev.message_id);
    if (!this.#inboundDeduper.shouldProcess(msgId)) return;
    if (Array.isArray(ev.message) || typeof ev.message === 'string') {
      ev = { ...ev, message: normalizeMessage(ev.message) };
    }
    const target = formatInboundTarget(ev);
    const content = formatInboundContent(ev);
    const nickname = senderNickname(ev);
    const mentioned = isNapCatBotMentioned(ev);
    void this.#options.gateway.receive({
      adapter: this.#options.id,
      target,
      content,
      sender: senderUserId(ev),
      id: msgId,
      metadata: Object.freeze({
        message_type: ev.message_type,
        user_id: ev.user_id != null ? String(ev.user_id) : undefined,
        group_id: ev.group_id != null ? String(ev.group_id) : undefined,
        endpoint: this.#options.config.name,
        time: ev.time,
        self_id: ev.self_id != null ? String(ev.self_id) : undefined,
        role: ev.sender?.role,
        ...(nickname ? { nickname } : {}),
        ...(mentioned ? { mentioned: true } : {}),
      }),
    }).catch((err) => {
      logger.warn(formatCompact({
        op: 'napcat_gateway_receive_failed',
        target,
        error: err instanceof Error ? err.message : String(err),
      }));
    });
  }

  async #connect(): Promise<void> {
    const { url, headers, safeUrl } = buildWsConnectOptions(this.#options.config);
    const create = this.#options.createWebSocket
      ?? ((connectUrl: string, options: NapCatWsCreateOptions) =>
        new WebSocket(connectUrl, { headers: options.headers }) as unknown as NapCatWsSocket);

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const ws = create(url, { headers });
      this.#ws = ws;

      ws.on('open', () => {
        if (settled) return;
        settled = true;
        if (!this.#options.config.access_token) {
          logger.warn(formatCompact({
            endpoint: this.#options.config.name,
            ok: false,
            error: 'missing access_token',
          }));
        }
        logger.debug(formatCompact({
          endpoint: this.#options.config.name,
          mode: 'ws',
          url: safeUrl,
        }));
        this.#heartbeatTimer = this.#stopping
          ? this.#heartbeatTimer
          : startNapCatHeartbeat(
            this.#ws,
            this.#options.config.heartbeat_interval,
            this.#heartbeatTimer,
          );
        resolve();
      });

      ws.on('message', (data) => {
        handleNapCatWsMessage(data, {
          endpointName: this.#options.config.name,
          pending: this.#pending,
          admit: (event) => this.admit(event),
        });
      });

      ws.on('close', (code, reason) => {
        const reasonStr = typeof reason === 'string'
          ? reason
          : Buffer.isBuffer(reason)
            ? reason.toString()
            : String(reason ?? '');
        const codeNum = typeof code === 'number' ? code : Number(code ?? 0);
        const codeHint = codeNum === 1005
          ? ' [no status]'
          : codeNum === 1006
            ? ' [abnormal]'
            : '';
        logger.warn(formatCompact({
          op: 'disconnect',
          endpoint: this.#options.config.name,
          code: codeNum,
          error: `${reasonStr || 'closed'}${codeHint}`,
          reconnect_ms: this.#options.config.reconnect_interval,
        }));
        if (!settled) {
          settled = true;
          reject(new Error(`NapCat WS closed: ${codeNum} ${reasonStr}`));
        }
        this.#scheduleReconnect();
      });

      ws.on('error', (err) => {
        const error = err instanceof Error ? err : new Error(String(err));
        logger.warn(formatCompact({
          op: 'ws_error',
          endpoint: this.#options.config.name,
          ok: false,
          error: error.message,
        }));
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
    });
  }

  #scheduleReconnect(): void {
    if (this.#stopping || !this.#started || this.#reconnectTimer) return;
    const delay = this.#options.config.reconnect_interval;
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = undefined;
      void this.#connect().catch((err) => {
        logger.warn(formatCompact({
          op: 'reconnect',
          endpoint: this.#options.config.name,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }));
      });
    }, delay);
  }
}
