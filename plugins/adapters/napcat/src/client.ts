import { defineEndpointClient } from 'zhin.js/adapter';
import type { NapCatEvent } from './protocol.js';

export type NapcatApiCall = (
  action: string,
  params?: Record<string, unknown>,
) => Promise<unknown>;

/** Transport-independent NapCat protocol Client produced by every Endpoint mode. */
export class NapcatClient {
  constructor(readonly callApi: NapcatApiCall) {}

  async setTitle(groupId: number, userId: number, title: string, duration = -1): Promise<boolean> {
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
  setQQProfile(nickname: string, company?: string, email?: string, college?: string, personalNote?: string) {
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
  uploadGroupFile(groupId: number, file: string, name: string, folder?: string) { return this.callApi('upload_group_file', { group_id: groupId, file, name, folder }); }
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
  getMiniAppArk(type: string, title: string, desc: string, picUrl: string, jumpUrl: string) { return this.callApi('get_mini_app_ark', { type, title, desc, picUrl, jumpUrl }); }
  getAiCharacters(groupId: number) { return this.callApi('get_ai_characters', { group_id: groupId }); }
  sendGroupAiRecord(groupId: number, characterId: string, text: string) {
    return this.callApi('send_group_ai_record', { group_id: groupId, character: characterId, text });
  }
}
export type NapcatClientEventMap = Record<string, NapCatEvent>;

declare module '@zhin.js/feature-kit' {
  interface AdapterClientRegistry {
    readonly napcat: {
      readonly client: NapcatClient;
      readonly events: NapcatClientEventMap;
    };
  }
}

export const napcatClient = defineEndpointClient<NapcatClient, NapcatClientEventMap>('napcat');
