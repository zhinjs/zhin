import { MessageV12 } from '@/message';
import { Dict } from 'zhin';

export type OneBotMethodsV12 = {
  send_private_msg(params: {
    user_id: string;
    message: MessageV12.Sendable;
    auto_escape?: boolean;
    message_id?: string;
  }): MessageV12.Ret;
  send_group_msg(params: {
    group_id: string;
    message: MessageV12.Sendable;
    auto_escape?: boolean;
    message_id?: string;
  }): MessageV12.Ret;
  send_msg(params: {
    message_type: 'private' | 'group';
    user_id?: number;
    group_id?: number;
    message: MessageV12.Sendable;
    auto_escape?: boolean;
  }): MessageV12.Ret;
  delete_msg(params: { message_id: number }): void;
  get_forward_msg(params: { id: string }): MessageV12.Segment[];
  send_like(params: { user_id: string; times?: number }): boolean;
  set_group_kick(params: { group_id: string; user_id: string; reject_add_request?: boolean }): boolean;
  set_group_ban(params: { group_id: string; user_id: string; duration?: number }): void;
  set_group_anonymous_ban(params: {
    group_id: string;
    anonymous?: Dict;
    anonymous_flag?: string;
    flag?: string;
    duration?: number;
  }): void;
  set_group_whole_ban(params: { group_id: string; enable?: boolean }): void;
  set_group_admin(params: { group_id: string; user_id: string; enable?: boolean }): boolean;
  set_group_anonymous(params: { group_id: string; enable?: boolean }): boolean;
  set_group_card(params: { group_id: string; user_id: string; card?: string }): boolean;
  set_group_name(params: { group_id: string; group_name: string }): boolean;
  set_group_leave(params: { group_id: string; is_dismiss?: boolean }): void;
  set_group_special_title(params: {
    group_id: string;
    user_id: string;
    special_title?: string;
    duration?: number;
  }): boolean;
  set_friend_add_request(params: { flag: string; approve?: boolean; remark?: string }): void;
  set_group_add_request(params: {
    flag: string;
    sub_type?: string;
    type?: string;
    approve?: boolean;
    reason?: string;
  }): void;
  get_login_info(params: object): { user_id: string; nickname: string };
  get_stranger_info(params: { user_id: string; no_cache?: boolean }): StrangerInfo;
  get_friend_list(params: object): FriendInfo[];
  get_group_info(params: { group_id: string; no_cache?: boolean }): GroupInfo;
  get_group_list(params: object): GroupInfo[];
  get_group_member_list(params: { group_id: string }): MemberInfo[];
  get_group_member_info(params: { group_id: string; user_id: string }): MemberInfo;
  get_group_honor_info(params: { group_id: string; type: string }): HonorInfo;
  get_cookies(params: { domain?: string }): { cookies: string };
  get_csrf_token(params: object): { token: number };
  get_credentials(params: { domain?: string }): { token: number; cookies: string };
  get_record(prams: { file: string; out_format: string }): { file: string };
  get_image(prams: { file: string }): { file: string };
  can_send_image(params: object): { yes: boolean };
  can_send_record(params: object): { yes: boolean };
  get_status(params: object): { online: boolean; good: boolean };
  get_version_info(params: object): { app_name: string; app_version: string; protocol_version: string };
  set_restart(params: { delay?: number }): void;
  clean_cache(params: object): void;
  '.handle_quick_operation'(params: { context: Dict; operation: Dict }): void;
  'set_essence_message'(params: { message_id: string }): string;
  remove_essence_message(params: { message_id: string }): boolean;
  send_group_notice(params: { group_id: string; content: string }): boolean;
  send_group_poke(params: { group_id: string; user_id: string }): boolean;
};
interface BaseInfo {
  user_id: string;
  nickname: string;
}
export interface StrangerInfo extends BaseInfo {
  sex: string;
  age: number;
}
export interface FriendInfo extends BaseInfo {
  remark: string;
}
export interface MemberInfo extends BaseInfo {
  group_id: string;
  card: string;
  sex: string;
  age: string;
  area: string;
  join_time: number;
  last_sent_time: number;
  level: string;
  role: string;
  unfriendly: boolean;
  title: string;
  title_expire_time: string;
  card_changeable: boolean;
}
export interface GroupInfo {
  group_id: string;
  group_name: string;
  member_count: number;
  max_member_count: number;
}
export interface TalkAtive extends BaseInfo {
  avatar: string;
  day_count: number;
}
export interface MemberHonor extends BaseInfo {
  avatar: string;
  description: string;
}
export interface HonorInfo {
  group_id: string;
  current_talkative?: TalkAtive;
  talkative_list?: MemberHonor[];
  performer_list?: MemberHonor[];
  legend_list?: MemberHonor[];
  strong_newbie_list?: MemberHonor[];
  emotion_list?: MemberHonor[];
}
