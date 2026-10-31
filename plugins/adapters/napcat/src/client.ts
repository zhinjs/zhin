import { EventEmitter } from 'node:events';
import { callNapCatHttpAction, readNapCatActionResponse, type NapCatEvent, type ResolvedNapCatConfig } from './protocol.js';
import { createNapCatRpc, type NapCatRpc } from './ws-transport.js';
import { EndpointDeliveryError } from '@zhin.js/im-contract';
import type { PendingRpcRequest } from 'zhin.js/adapter';
import type { NapCatWsSocket } from './ws-types.js';

export type NapcatApiCall = (
  action: string,
  params?: Record<string, unknown>,
) => Promise<unknown>;

/** Platform actions use one named payload; wire field names stay inside this Client. */
export interface NapcatMemberTitleRequest {
  readonly groupId: number;
  readonly userId: number;
  readonly title: string;
  /** Platform duration; omission retains the existing indefinite value (-1). */
  readonly duration?: number;
}
export interface NapcatProfileRequest {
  readonly nickname: string;
  readonly company?: string;
  readonly email?: string;
  readonly college?: string;
  readonly personalNote?: string;
}
export interface NapcatGroupFileRequest {
  readonly groupId: number;
  readonly file: string;
  readonly name: string;
  readonly folder?: string;
}
export interface NapcatMiniAppRequest {
  readonly type: string;
  readonly title: string;
  readonly desc: string;
  readonly picUrl: string;
  readonly jumpUrl: string;
}

export interface NapcatClientOptions {
  readonly config: ResolvedNapCatConfig;
  readonly httpAction?: typeof callNapCatHttpAction;
  readonly signal?: AbortSignal;
}

/** Transport-independent NapCat protocol Client produced by every Endpoint mode. */
export class NapcatClient extends EventEmitter<Record<string, [NapCatEvent]>> {
  protected transportSocket?: NapCatWsSocket;
  protected readonly rpc: NapCatRpc;
  protected readonly protocolConfig: ResolvedNapCatConfig;
  readonly #httpAction: typeof callNapCatHttpAction;
  readonly #executionSignal?: AbortSignal;

  constructor(options: NapcatClientOptions) {
    super();
    this.protocolConfig = options.config;
    this.#httpAction = options.httpAction ?? callNapCatHttpAction;
    this.#executionSignal = options.signal;
    this.rpc = createNapCatRpc({ endpointId: options.config.id, signal: options.signal,
      socket: () => this.actionSocket });
  }

  ingest(event: NapCatEvent): void {
    this.emit('event', event);
    const name = [event.post_type, event.message_type ?? event.notice_type ?? event.request_type, event.sub_type].filter(Boolean).join('.');
    if (name && name !== 'event') this.emit(name, event);
  }

  protected get actionSocket(): NapCatWsSocket | undefined { return this.transportSocket; }

  /** Existing platform methods retain their native action/params calling convention. */
  readonly callApi: NapcatApiCall = (action, params = {}) => this.requestApi({ action, params });

  /** A semantic operation supplies its caller lifetime to the same native protocol owner. */
  async requestApi(request: PendingRpcRequest): Promise<unknown> {
    const signals = [this.#executionSignal, request.signal].filter((signal): signal is AbortSignal => !!signal);
    const signal = signals.length ? AbortSignal.any(signals) : undefined;
    if (signal?.aborted) throw new EndpointDeliveryError('endpoint_inactive', 'Endpoint operation ended', 'not_sent');
    if (this.protocolConfig.connection === 'http') {
      try {
        const response = await this.#httpAction({ http_url: this.protocolConfig.http_url,
          access_token: this.protocolConfig.access_token, signal }, request.action, request.params ?? {});
        if (signal?.aborted) throw new EndpointDeliveryError('endpoint_inactive', 'Endpoint operation cancelled', 'unknown');
        return readNapCatActionResponse(response).data;
      } catch (cause) {
        if (cause instanceof EndpointDeliveryError) throw cause;
        throw new EndpointDeliveryError('delivery_unconfirmed', cause instanceof Error ? cause.message : String(cause), 'unknown', { cause });
      }
    }
    const response = await this.rpc.call({ ...request, signal });
    return readNapCatActionResponse(response).data;
  }

  async setTitle({ groupId, userId, title, duration = -1 }: NapcatMemberTitleRequest): Promise<boolean> {
    await this.callApi('set_group_special_title', {
      group_id: groupId,
      user_id: userId,
      special_title: title,
      duration,
    });
    return true;
  }

  sendLike(userId: number, times = 1) { return this.callApi('send_like', { user_id: userId, times }); }
  deleteFriend(userId: number) { return this.callApi('delete_friend', { user_id: userId }); }
  markMsgAsRead(messageId: number) { return this.callApi('mark_msg_as_read', { message_id: messageId }); }
  ocrImage(image: string) { return this.callApi('ocr_image', { image }); }
  setQQProfile({ nickname, company, email, college, personalNote }: NapcatProfileRequest) {
    return this.callApi('set_qq_profile', { nickname, company, email, college, personal_note: personalNote });
  }
  setGroupPortrait(groupId: number, file: string) { return this.callApi('set_group_portrait', { group_id: groupId, file }); }
  setEssenceMsg(messageId: number) { return this.callApi('set_essence_msg', { message_id: messageId }); }
  deleteEssenceMsg(messageId: number) { return this.callApi('delete_essence_msg', { message_id: messageId }); }
  getEssenceMsgList(groupId: number) { return this.callApi('get_essence_msg_list', { group_id: groupId }); }
  sendGroupSign(groupId: number) { return this.callApi('send_group_sign', { group_id: groupId }); }
  sendGroupNotice(groupId: number, content: string, image?: string) { return this.callApi('_send_group_notice', { group_id: groupId, content, image }); }
  getGroupNotice(groupId: number) { return this.callApi('_get_group_notice', { group_id: groupId }); }
  deleteGroupNotice(groupId: number, noticeId: string) { return this.callApi('_del_group_notice', { group_id: groupId, notice_id: noticeId }); }
  uploadGroupFile({ groupId, file, name, folder }: NapcatGroupFileRequest) { return this.callApi('upload_group_file', { group_id: groupId, file, name, folder }); }
  getGroupRootFiles(groupId: number) { return this.callApi('get_group_root_files', { group_id: groupId }); }
  getGroupFileUrl(groupId: number, fileId: string, busid: number) { return this.callApi('get_group_file_url', { group_id: groupId, file_id: fileId, busid }); }
  downloadFile(url: string, threadCount = 1, headers?: string[]) { return this.callApi('download_file', { url, thread_count: threadCount, headers }); }
  setOnlineStatus(status: number, extStatus: number) { return this.callApi('set_online_status', { status, ext_status: extStatus }); }
  setQQAvatar(file: string) { return this.callApi('set_qq_avatar', { file }); }
  forwardFriendSingleMsg(userId: number, messageId: number) { return this.callApi('forward_friend_single_msg', { user_id: userId, message_id: messageId }); }
  forwardGroupSingleMsg(groupId: number, messageId: number) { return this.callApi('forward_group_single_msg', { group_id: groupId, message_id: messageId }); }
  translateEn2Zh(sourceText: string) { return this.callApi('translate_en2zh', { source_text: sourceText }); }
  setMsgEmojiLike(messageId: number, emojiId: string) { return this.callApi('set_msg_emoji_like', { message_id: messageId, emoji_id: emojiId }); }
  sendForwardMsg(messageType: 'private' | 'group', id: number, messages: unknown[]) {
    return this.callApi('send_forward_msg', {
      message_type: messageType,
      [messageType === 'group' ? 'group_id' : 'user_id']: id,
      messages,
    });
  }
  getFriendMsgHistory(userId: number, messageSeq?: number, count?: number) { return this.callApi('get_friend_msg_history', { user_id: userId, message_seq: messageSeq, count }); }
  getGroupMsgHistory(groupId: number, messageSeq?: number, count?: number) { return this.callApi('get_group_msg_history', { group_id: groupId, message_seq: messageSeq, count }); }
  setSelfLongnick(longnick: string) { return this.callApi('set_self_longnick', { longNick: longnick }); }
  getGroupInfoEx(groupId: number) { return this.callApi('get_group_info_ex', { group_id: groupId }); }
  sendPoke(userId: number, groupId?: number) { return this.callApi('send_poke', { user_id: userId, group_id: groupId }); }
  ncGetUserStatus(userId: number) { return this.callApi('nc_get_user_status', { user_id: userId }); }
  getGroupShutList(groupId: number) { return this.callApi('get_group_shut_list', { group_id: groupId }); }
  getMiniAppArk({ type, title, desc, picUrl, jumpUrl }: NapcatMiniAppRequest) { return this.callApi('get_mini_app_ark', { type, title, desc, picUrl, jumpUrl }); }
  getAiCharacters(groupId: number) { return this.callApi('get_ai_characters', { group_id: groupId }); }
  sendGroupAiRecord(groupId: number, characterId: string, text: string) {
    return this.callApi('send_group_ai_record', { group_id: groupId, character: characterId, text });
  }
}
export type NapcatClientEventMap = Record<string, NapCatEvent>;
