/**
 * NapCat Bot 抽象基类
 * 子类只需实现 callApi / $connect / $disconnect，其余 API 方法和事件处理全部复用。
 */
import { EventEmitter } from 'events';
import {
  Bot,
  Message,
  SendOptions,
  segment,
  Notice,
  Request,
} from 'zhin.js';
import type { NapCatBotConfig, NapCatMessageEvent, MessageSegment, ApiResponse } from './types.js';
import type { NapCatAdapter } from './adapter.js';

export abstract class NapCatBotBase extends EventEmitter implements Bot<NapCatBotConfig, NapCatMessageEvent> {
  $connected = false;

  get logger() { return this.adapter.plugin.logger; }
  get $id() { return this.$config.name; }

  constructor(public adapter: NapCatAdapter, public $config: NapCatBotConfig) {
    super();
  }

  abstract $connect(): Promise<void>;
  abstract $disconnect(): Promise<void>;
  abstract callApi<T = any>(action: string, params?: Record<string, any>): Promise<T>;

  // ══════════════════════════════════════════════════════════════════
  // 消息格式化
  // ══════════════════════════════════════════════════════════════════

  $formatMessage(ev: NapCatMessageEvent): Message<NapCatMessageEvent> {
    const message = Message.from(ev, {
      $id: ev.message_id.toString(),
      $adapter: 'napcat',
      $bot: this.$config.name,
      $sender: {
        id: ev.user_id.toString(),
        name: ev.sender?.nickname || ev.user_id.toString(),
        role: ev.sender?.role,
      },
      $channel: {
        id: (ev.group_id || ev.user_id).toString(),
        type: ev.group_id ? 'group' : 'private',
      },
      $content: ev.message,
      $raw: ev.raw_message,
      $timestamp: ev.time,
      $recall: async () => { await this.deleteMsg(ev.message_id); },
      $reply: async (content: any[], quote?: boolean | string): Promise<string> => {
        if (quote) content.unshift({ type: 'reply', data: { message_id: ev.message_id.toString() } });
        return await this.adapter.sendMessage({
          id: (ev.group_id || ev.user_id).toString(),
          type: ev.group_id ? 'group' : 'private',
          context: 'napcat',
          bot: this.$config.name,
          content,
        });
      },
    });
    return message;
  }

  async $sendMessage(options: SendOptions): Promise<string> {
    const msg: any = { message: options.content };
    if (options.type === 'group') {
      const result = await this.callApi<{ message_id: number }>('send_group_msg', { group_id: parseInt(options.id), ...msg });
      this.logger.debug(`${this.$id} send group(${options.id}):${segment.raw(options.content)}`);
      return result.message_id.toString();
    }
    if (options.type === 'private') {
      const result = await this.callApi<{ message_id: number }>('send_private_msg', { user_id: parseInt(options.id), ...msg });
      this.logger.debug(`${this.$id} send private(${options.id}):${segment.raw(options.content)}`);
      return result.message_id.toString();
    }
    throw new Error('Either group_id or user_id must be provided');
  }

  async $recallMessage(id: string): Promise<void> {
    await this.deleteMsg(parseInt(id));
  }

  // ══════════════════════════════════════════════════════════════════
  // 事件分发
  // ══════════════════════════════════════════════════════════════════

  protected dispatchEvent(event: any): void {
    switch (event.post_type) {
      case 'message':
      case 'message_sent':
        return this.handleMessage(event);
      case 'notice':
        return this.handleNotice(event);
      case 'request':
        return this.handleRequest(event);
      case 'meta_event':
        return this.handleMeta(event);
    }
  }

  private handleMessage(ev: NapCatMessageEvent): void {
    const message = this.$formatMessage(ev);
    this.adapter.emit('message.receive', message);
    this.logger.debug(`${this.$id} recv ${message.$channel.type}(${message.$channel.id}):${segment.raw(message.$content)}`);
  }

  private handleNotice(event: any): void {
    const noticeTypeMap: Record<string, string> = {
      group_increase: 'group_member_increase',
      group_decrease: 'group_member_decrease',
      group_admin: 'group_admin_change',
      group_ban: 'group_ban',
      group_recall: 'group_recall',
      friend_recall: 'friend_recall',
      friend_add: 'friend_add',
      group_upload: 'group_upload',
      group_card: 'group_card_change',
      essence: event.sub_type === 'add' ? 'essence_add' : 'essence_delete',
      notify: this.resolveNotifyType(event),
      group_msg_emoji_like: 'group_emoji_reaction',
    };
    const $type = noticeTypeMap[event.notice_type] || event.notice_type;
    const isGroup = !!event.group_id;
    const notice = Notice.from(event, {
      $id: `${event.time}_${event.notice_type}_${event.group_id || event.user_id}`,
      $adapter: 'napcat',
      $bot: this.$config.name,
      $type,
      $subType: event.sub_type,
      $channel: {
        id: (event.group_id || event.user_id)?.toString() || '',
        type: isGroup ? 'group' : 'private',
      },
      $operator: event.operator_id ? { id: event.operator_id.toString(), name: event.operator_id.toString() } : undefined,
      $target: event.user_id ? { id: event.user_id.toString(), name: event.user_id.toString() } : undefined,
      $timestamp: event.time || Math.floor(Date.now() / 1000),
    });
    this.adapter.emit('notice.receive', notice);
  }

  private resolveNotifyType(event: any): string {
    switch (event.sub_type) {
      case 'poke': return event.group_id ? 'group_poke' : 'friend_poke';
      case 'input_status': return 'input_status';
      case 'title': return 'title_change';
      case 'profile_like': return 'profile_like';
      default: return `notify_${event.sub_type}`;
    }
  }

  private handleRequest(event: any): void {
    const typeMap: Record<string, string> = {
      friend: 'friend_add',
      group: event.sub_type === 'invite' ? 'group_invite' : 'group_add',
    };
    const $type = typeMap[event.request_type] || event.request_type;
    const request = Request.from(event, {
      $id: event.flag || `${event.time}_${event.request_type}_${event.user_id}`,
      $adapter: 'napcat',
      $bot: this.$config.name,
      $type,
      $subType: event.sub_type,
      $channel: {
        id: (event.group_id || event.user_id)?.toString() || '',
        type: event.group_id ? 'group' : 'private',
      },
      $sender: { id: event.user_id?.toString() || '', name: event.user_id?.toString() || '' },
      $comment: event.comment,
      $timestamp: event.time || Math.floor(Date.now() / 1000),
      $approve: async (remark?: string) => {
        await this.callApi(
          event.request_type === 'friend' ? 'set_friend_add_request' : 'set_group_add_request',
          { flag: event.flag, approve: true, remark },
        );
      },
      $reject: async (reason?: string) => {
        await this.callApi(
          event.request_type === 'friend' ? 'set_friend_add_request' : 'set_group_add_request',
          { flag: event.flag, approve: false, reason },
        );
      },
    });
    this.adapter.emit('request.receive', request);
  }

  protected handleMeta(event: any): void {
    // subclass may override for lifecycle handling
  }

  // ══════════════════════════════════════════════════════════════════
  // OneBot11 标准 API
  // ══════════════════════════════════════════════════════════════════

  async sendMsg(messageType: 'private' | 'group', id: number, message: MessageSegment[]) {
    return this.callApi<{ message_id: number }>('send_msg', { message_type: messageType, [messageType === 'group' ? 'group_id' : 'user_id']: id, message });
  }
  async deleteMsg(messageId: number) { return this.callApi('delete_msg', { message_id: messageId }); }
  async getMsg(messageId: number) { return this.callApi('get_msg', { message_id: messageId }); }
  async getForwardMsg(id: string) { return this.callApi('get_forward_msg', { id }); }
  async sendLike(userId: number, times = 1) { return this.callApi('send_like', { user_id: userId, times }); }

  // 群管理
  async setGroupKick(groupId: number, userId: number, rejectAddRequest = false) { return this.callApi('set_group_kick', { group_id: groupId, user_id: userId, reject_add_request: rejectAddRequest }); }
  async setGroupBan(groupId: number, userId: number, duration = 600) { return this.callApi('set_group_ban', { group_id: groupId, user_id: userId, duration }); }
  async setGroupWholeBan(groupId: number, enable = true) { return this.callApi('set_group_whole_ban', { group_id: groupId, enable }); }
  async setGroupAdmin(groupId: number, userId: number, enable = true) { return this.callApi('set_group_admin', { group_id: groupId, user_id: userId, enable }); }
  async setGroupCard(groupId: number, userId: number, card: string) { return this.callApi('set_group_card', { group_id: groupId, user_id: userId, card }); }
  async setGroupName(groupId: number, groupName: string) { return this.callApi('set_group_name', { group_id: groupId, group_name: groupName }); }
  async setGroupLeave(groupId: number, isDismiss = false) { return this.callApi('set_group_leave', { group_id: groupId, is_dismiss: isDismiss }); }
  async setGroupSpecialTitle(groupId: number, userId: number, specialTitle: string, duration = -1) { return this.callApi('set_group_special_title', { group_id: groupId, user_id: userId, special_title: specialTitle, duration }); }

  // 好友/群请求
  async setFriendAddRequest(flag: string, approve = true, remark?: string) { return this.callApi('set_friend_add_request', { flag, approve, remark }); }
  async setGroupAddRequest(flag: string, subType: string, approve = true, reason?: string) { return this.callApi('set_group_add_request', { flag, sub_type: subType, approve, reason }); }

  // 信息查询
  async getLoginInfo() { return this.callApi('get_login_info'); }
  async getStrangerInfo(userId: number, noCache = false) { return this.callApi('get_stranger_info', { user_id: userId, no_cache: noCache }); }
  async getFriendList() { return this.callApi('get_friend_list'); }
  async getGroupInfo(groupId: number, noCache = false) { return this.callApi('get_group_info', { group_id: groupId, no_cache: noCache }); }
  async getGroupList() { return this.callApi('get_group_list'); }
  async getGroupMemberInfo(groupId: number, userId: number, noCache = false) { return this.callApi('get_group_member_info', { group_id: groupId, user_id: userId, no_cache: noCache }); }
  async getGroupMemberList(groupId: number) { return this.callApi('get_group_member_list', { group_id: groupId }); }
  async getGroupHonorInfo(groupId: number, type: string) { return this.callApi('get_group_honor_info', { group_id: groupId, type }); }

  // 凭证
  async getCookies(domain?: string) { return this.callApi('get_cookies', { domain }); }
  async getCsrfToken() { return this.callApi('get_csrf_token'); }
  async getCredentials(domain?: string) { return this.callApi('get_credentials', { domain }); }

  // 媒体
  async getRecord(file: string, outFormat: string) { return this.callApi('get_record', { file, out_format: outFormat }); }
  async getImage(file: string) { return this.callApi('get_image', { file }); }
  async canSendImage() { return this.callApi('can_send_image'); }
  async canSendRecord() { return this.callApi('can_send_record'); }

  // 系统
  async getStatus() { return this.callApi('get_status'); }
  async getVersionInfo() { return this.callApi('get_version_info'); }
  async cleanCache() { return this.callApi('clean_cache'); }

  // ══════════════════════════════════════════════════════════════════
  // go-cqhttp 扩展 API
  // ══════════════════════════════════════════════════════════════════

  async setQQProfile(nickname: string, company?: string, email?: string, college?: string, personalNote?: string) {
    return this.callApi('set_qq_profile', { nickname, company, email, college, personal_note: personalNote });
  }
  async getOnlineClients(noCache = false) { return this.callApi('get_online_clients', { no_cache: noCache }); }
  async deleteFriend(userId: number) { return this.callApi('delete_friend', { user_id: userId }); }
  async markMsgAsRead(messageId: number) { return this.callApi('mark_msg_as_read', { message_id: messageId }); }
  async sendGroupForwardMsg(groupId: number, messages: any[]) { return this.callApi('send_group_forward_msg', { group_id: groupId, messages }); }
  async sendPrivateForwardMsg(userId: number, messages: any[]) { return this.callApi('send_private_forward_msg', { user_id: userId, messages }); }
  async getGroupMsgHistory(groupId: number, messageSeq?: number, count?: number) { return this.callApi('get_group_msg_history', { group_id: groupId, message_seq: messageSeq, count }); }
  async ocrImage(image: string) { return this.callApi('ocr_image', { image }); }
  async getGroupSystemMsg() { return this.callApi('get_group_system_msg'); }
  async getEssenceMsgList(groupId: number) { return this.callApi('get_essence_msg_list', { group_id: groupId }); }
  async getGroupAtAllRemain(groupId: number) { return this.callApi('get_group_at_all_remain', { group_id: groupId }); }
  async setGroupPortrait(groupId: number, file: string) { return this.callApi('set_group_portrait', { group_id: groupId, file }); }
  async setEssenceMsg(messageId: number) { return this.callApi('set_essence_msg', { message_id: messageId }); }
  async deleteEssenceMsg(messageId: number) { return this.callApi('delete_essence_msg', { message_id: messageId }); }
  async sendGroupSign(groupId: number) { return this.callApi('send_group_sign', { group_id: groupId }); }
  async sendGroupNotice(groupId: number, content: string, image?: string) { return this.callApi('_send_group_notice', { group_id: groupId, content, image }); }
  async getGroupNotice(groupId: number) { return this.callApi('_get_group_notice', { group_id: groupId }); }
  async deleteGroupNotice(groupId: number, noticeId: string) { return this.callApi('_del_group_notice', { group_id: groupId, notice_id: noticeId }); }
  async uploadGroupFile(groupId: number, file: string, name: string, folder?: string) { return this.callApi('upload_group_file', { group_id: groupId, file, name, folder }); }
  async deleteGroupFile(groupId: number, fileId: string, busid: number) { return this.callApi('delete_group_file', { group_id: groupId, file_id: fileId, busid }); }
  async createGroupFileFolder(groupId: number, name: string, parentId = '/') { return this.callApi('create_group_file_folder', { group_id: groupId, name, parent_id: parentId }); }
  async deleteGroupFolder(groupId: number, folderId: string) { return this.callApi('delete_group_folder', { group_id: groupId, folder_id: folderId }); }
  async getGroupFileSystemInfo(groupId: number) { return this.callApi('get_group_file_system_info', { group_id: groupId }); }
  async getGroupRootFiles(groupId: number) { return this.callApi('get_group_root_files', { group_id: groupId }); }
  async getGroupFilesByFolder(groupId: number, folderId: string) { return this.callApi('get_group_files_by_folder', { group_id: groupId, folder_id: folderId }); }
  async getGroupFileUrl(groupId: number, fileId: string, busid: number) { return this.callApi('get_group_file_url', { group_id: groupId, file_id: fileId, busid }); }
  async uploadPrivateFile(userId: number, file: string, name: string) { return this.callApi('upload_private_file', { user_id: userId, file, name }); }
  async downloadFile(url: string, threadCount = 1, headers?: string[]) { return this.callApi('download_file', { url, thread_count: threadCount, headers }); }
  async checkUrlSafely(url: string) { return this.callApi('check_url_safely', { url }); }

  // ══════════════════════════════════════════════════════════════════
  // NapCat 独有 API
  // ══════════════════════════════════════════════════════════════════

  async setGroupSign(groupId: number) { return this.callApi('set_group_sign', { group_id: groupId }); }
  async arkSharePeer(userId: number) { return this.callApi('ArkSharePeer', { user_id: userId }); }
  async arkShareGroup(groupId: number) { return this.callApi('ArkShareGroup', { group_id: groupId }); }
  async getRobotUinRange() { return this.callApi('get_robot_uin_range'); }
  async setOnlineStatus(status: number, extStatus: number) { return this.callApi('set_online_status', { status, ext_status: extStatus }); }
  async getFriendsWithCategory() { return this.callApi('get_friends_with_category'); }
  async setQQAvatar(file: string) { return this.callApi('set_qq_avatar', { file }); }
  async getFile(fileId: string) { return this.callApi('get_file', { file_id: fileId }); }
  async forwardFriendSingleMsg(userId: number, messageId: number) { return this.callApi('forward_friend_single_msg', { user_id: userId, message_id: messageId }); }
  async forwardGroupSingleMsg(groupId: number, messageId: number) { return this.callApi('forward_group_single_msg', { group_id: groupId, message_id: messageId }); }
  async translateEn2Zh(sourceText: string) { return this.callApi('translate_en2zh', { source_text: sourceText }); }
  async setMsgEmojiLike(messageId: number, emojiId: string) { return this.callApi('set_msg_emoji_like', { message_id: messageId, emoji_id: emojiId }); }
  async sendForwardMsg(messageType: 'private' | 'group', id: number, messages: any[]) {
    return this.callApi('send_forward_msg', { message_type: messageType, [messageType === 'group' ? 'group_id' : 'user_id']: id, messages });
  }
  async markPrivateMsgAsRead(userId: number) { return this.callApi('mark_private_msg_as_read', { user_id: userId }); }
  async markGroupMsgAsRead(groupId: number) { return this.callApi('mark_group_msg_as_read', { group_id: groupId }); }
  async getFriendMsgHistory(userId: number, messageSeq?: number, count?: number) { return this.callApi('get_friend_msg_history', { user_id: userId, message_seq: messageSeq, count }); }
  async createCollection(briefContent: string, rawData: string) { return this.callApi('create_collection', { brief: briefContent, rawData }); }
  async getCollectionList(page = 0, limit = 20) { return this.callApi('get_collection_list', { page, limit }); }
  async setSelfLongnick(longnick: string) { return this.callApi('set_self_longnick', { longNick: longnick }); }
  async getRecentContact(count = 10) { return this.callApi('get_recent_contact', { count }); }
  async markAllAsRead() { return this.callApi('_mark_all_as_read'); }
  async getProfileLike() { return this.callApi('get_profile_like'); }
  async fetchCustomFace() { return this.callApi('fetch_custom_face'); }
  async fetchEmojiLike(messageId: number, emojiId: string, emojiType: string) { return this.callApi('fetch_emoji_like', { message_id: messageId, emoji_id: emojiId, emoji_type: emojiType }); }
  async setInputStatus(userId: number, eventType: string) { return this.callApi('set_input_status', { user_id: userId, event_type: eventType }); }
  async getGroupInfoEx(groupId: number) { return this.callApi('get_group_info_ex', { group_id: groupId }); }
  async getGroupIgnoreAddRequest(groupId: number) { return this.callApi('get_group_ignore_add_request', { group_id: groupId }); }
  async friendPoke(userId: number) { return this.callApi('friend_poke', { user_id: userId }); }
  async groupPoke(groupId: number, userId: number) { return this.callApi('group_poke', { group_id: groupId, user_id: userId }); }
  async sendPoke(userId: number, groupId?: number) { return this.callApi('send_poke', { user_id: userId, group_id: groupId }); }
  async ncGetPacketStatus() { return this.callApi('nc_get_packet_status'); }
  async ncGetUserStatus(userId: number) { return this.callApi('nc_get_user_status', { user_id: userId }); }
  async ncGetRkey() { return this.callApi('nc_get_rkey'); }
  async getGroupShutList(groupId: number) { return this.callApi('get_group_shut_list', { group_id: groupId }); }
  async getMiniAppArk(type: string, title: string, desc: string, picUrl: string, jumpUrl: string) {
    return this.callApi('get_mini_app_ark', { type, title, desc, picUrl, jumpUrl });
  }
  async getAiRecord(groupId: number, characterId: string, text: string) { return this.callApi('get_ai_record', { group_id: groupId, character: characterId, text }); }
  async getAiCharacters(groupId: number) { return this.callApi('get_ai_characters', { group_id: groupId }); }
  async sendGroupAiRecord(groupId: number, characterId: string, text: string) { return this.callApi('send_group_ai_record', { group_id: groupId, character: characterId, text }); }

  // ══════════════════════════════════════════════════════════════════
  // Adapter 群管理接口适配
  // ══════════════════════════════════════════════════════════════════

  async kickMember(groupId: number, userId: number, reject = false) { await this.setGroupKick(groupId, userId, reject); return true; }
  async muteMember(groupId: number, userId: number, duration = 600) { await this.setGroupBan(groupId, userId, duration); return true; }
  async muteAll(groupId: number, enable = true) { await this.setGroupWholeBan(groupId, enable); return true; }
  async setAdmin(groupId: number, userId: number, enable = true) { await this.setGroupAdmin(groupId, userId, enable); return true; }
  async setCard(groupId: number, userId: number, card: string) { await this.setGroupCard(groupId, userId, card); return true; }
  async setTitle(groupId: number, userId: number, title: string, duration = -1) { await this.setGroupSpecialTitle(groupId, userId, title, duration); return true; }
  async getMemberList(groupId: number) { return this.getGroupMemberList(groupId); }
}
