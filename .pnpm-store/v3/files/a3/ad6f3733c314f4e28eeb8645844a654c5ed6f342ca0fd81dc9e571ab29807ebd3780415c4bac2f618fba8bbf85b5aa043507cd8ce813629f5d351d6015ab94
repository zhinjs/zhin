import { Gender, GroupRole } from "./common";
/** 陌生人资料 */
export interface StrangerInfo {
    /** 帐号 */
    user_id: number;
    /** 昵称 */
    nickname: string;
}
/** 好友资料 */
export interface FriendInfo extends StrangerInfo {
    /** 性别 */
    sex: Gender;
    /** 备注 */
    remark: string;
    /** 分组id */
    class_id: number;
}
/** 群资料 */
export interface GroupInfo {
    /** 群号 */
    group_id: number;
    /** 群名 */
    group_name: string;
    /** 群员数 */
    member_count: number;
    /** 群员上限 */
    max_member_count: number;
    /** 群主账号 */
    owner_id: number;
    /** 是否为该群管理员 */
    admin_flag: boolean;
    /** 上次入群时间 */
    last_join_time: number;
    /** 上次发言时间 */
    last_sent_time?: number;
    /** 全体禁言时间 */
    shutup_time_whole: number;
    /** 被禁言时间 */
    shutup_time_me: number;
    /** 群创建时间 */
    create_time?: number;
    /** 群活跃等级 */
    grade?: number;
    /** 管理员上限 */
    max_admin_count?: number;
    /** 在线群员数 */
    active_member_count?: number;
    /** 群信息更新时间 */
    update_time: number;
}
/** 群员资料 */
export interface MemberInfo {
    /** 所在群号 */
    group_id: number;
    /** 群员账号 */
    user_id: number;
    /** 昵称 */
    nickname: string;
    /** 性别 */
    sex: Gender;
    /** 群名片 */
    card: string;
    /** 年龄 */
    age: number;
    /** 地区 */
    area?: string;
    /** 入群时间 */
    join_time: number;
    /** 上次发言时间 */
    last_sent_time: number;
    /** 聊天等级 */
    level: number;
    /** 聊天排名 */
    rank?: string;
    /** 群权限 */
    role: GroupRole;
    /** 头衔 */
    title: string;
    /** 头衔到期时间 */
    title_expire_time: number;
    /** 禁言时间 */
    shutup_time: number;
    /** 群员信息更新时间 */
    update_time: number;
}
