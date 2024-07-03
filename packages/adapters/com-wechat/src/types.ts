import { Message } from '@/message';
import { Dict } from 'zhin';

export type ComServerMethods = {
  send_message(params: {
    user_id?: string;
    group_id?: string;
    detail_type: string;
    message: Message.Sendable;
  }): Message.Ret;
  get_self_info(params: {} | null): BaseInfo;
  get_user_info(params: { user_id: string }): FriendInfo;
  get_friend_list(params: {} | null): FriendInfo[];
  get_friend_list(params: object): FriendInfo[];
  get_group_info(params: { group_id: string }): GroupInfo;
  get_group_list(params: object): GroupInfo[];
  get_group_member_list(params: { group_id: string }): UserInfo[];
  get_group_member_info(params: { group_id: string; user_id: string }): UserInfo;
  set_group_name(params: { group_id: string; group_name: string }): null;
  upload_file(params: UploadFileParams): { file_id: string };
  get_file(params: { file_id: string; type: 'url' | 'path' | 'data' }): UploadFileParams;
  'wx.get_public_account_list'(): PublicAccountInfo[];
  'wx.follow_public_account'(params: { user_id: string }): null;
  'wx.search_contact_by_remark'(params: { remark: string }): FriendInfo;
  'wx.search_contact_by_wxnumber'(params: { wx_number: string }): FriendInfo;
  'wx.search_contact_by_nickname'(params: { nickname: string }): FriendInfo;
  'wx.check_friend_status'(params: { user_id: string }): FriendStatus;
  'wx.accept_friend'(params: { v3: string; v4: string }): null;
  'wx.delete_friend'(params: { user_id: string }): null;
  'wx.set_remark'(params: { user_id: string; remark: string }): null;
  'wx.set_group_announcement'(params: { group_id: string; announcement: string }): null;
  'wx.set_group_nickname'(params: { group_id: string; nickname: string }): null;
  'wx.get_groupmember_nickname'(params: { group_id: string; user_id: string }): string;
  'wx.add_groupmember'(params: { group_id: string; user_id: string }): null;
  'wx.delete_groupmember'(params: { group_id: string; user_id: string }): null;
  'wx.get_public_history'(params: { public_id: string; offset: number }): PublicMessage[];
  'wx.send_forward_msg'(params: { user_id: string; message_id: string }): null;
  'wx.send_raw_xml'(params: { user_id: string; xml: string; image_path?: string }): null;
  'wx.send_card'(params: { card_id: string; user_id: string; nickname: string }): null;
  'wx.clean_cache'(params: { days: number }): number;
  'wx.get_wechat_version'(): string;
  'wx.set_wechat_version'(params: { version: string }): null;
};
interface BaseInfo {
  user_id: string;
  user_name: string;
  user_displayname: string;
}
export interface UserInfo extends BaseInfo {
  'wx.avatar': string;
  'wx.wx_number': string;
  'wx.nation': string;
  'wx.province': string;
  'wx.city': string;
}
export interface FriendInfo extends UserInfo {
  'user_remark': string;
  'wx.verify_flag'?: string;
}
export interface GroupInfo {
  'group_id': string;
  'group_name': string;
  'wx.avatar'?: string;
}
export type UploadFileParams = UploadFromUrl | UploadFromPath | UploadFromData;
interface UploadFromUrl {
  type: 'url';
  name: string;
  headers?: Dict;
  url: string;
}
interface UploadFromPath {
  type: 'path';
  name: string;
  path: string;
}
interface UploadFromData {
  type: 'data';
  name: string;
  data: string;
}
export interface PublicAccountInfo extends Omit<BaseInfo, 'user_displaynames'> {
  wx_number: string;
}
export enum FriendStatus {
  Unknow = 0x00,
  Deleted = 0xb0,
  Friend,
  Blacked,
  BeBlack = 0xb5,
}
export interface PublicMessage {
  title: string;
  content: string;
  url: string;
  time: number;
}
