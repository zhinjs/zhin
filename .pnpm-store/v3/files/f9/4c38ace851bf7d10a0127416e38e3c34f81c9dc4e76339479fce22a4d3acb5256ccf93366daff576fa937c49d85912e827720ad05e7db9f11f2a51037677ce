/// <reference types="node" />
import { Gender, GroupRole } from "./common";
import { PrivateMessage, GroupMessage, DiscussMessage, Sendable } from "./message";
import { GuildMessageEvent } from "./internal";
import { Friend, FriendNoticeEventMap, FriendRequestEventMap, PrivateMessageEventMap } from "./friend";
import { Group, Discuss, GroupRequestEventMap, GroupNoticeEventMap, GroupMessageEventMap } from "./group";
import { Member } from "./member";
import { MemberInfo } from "./entities";
import { LoginErrorCode } from "./errors";
/** 发消息的返回值 */
export interface MessageRet {
    /** 消息id */
    message_id: string;
    seq: number;
    rand: number;
    time: number;
}
/** 所有消息共通属性 */
export interface MessageEvent {
    /**
     * 快速回复
     * @param content 消息内容
     * @param quote 引用这条消息(默认false)
     */
    reply(content: Sendable, quote?: boolean): Promise<MessageRet>;
}
/** 私聊消息 */
export interface PrivateMessageEvent extends PrivateMessage, MessageEvent {
    /** 好友对象 */
    friend: Friend;
}
/** 群消息 */
export interface GroupMessageEvent extends GroupMessage, MessageEvent {
    /** 快速撤回 */
    recall(): Promise<boolean>;
    /** 群对象 */
    group: Group;
    /** 发送者群员对象 */
    member: Member;
}
/** 讨论组消息 */
export interface DiscussMessageEvent extends DiscussMessage, MessageEvent {
    /** 讨论组对象 */
    discuss: Discuss;
}
/** 所有申请共通属性 */
export interface RequestEvent {
    post_type: "request";
    /** 账号 */
    user_id: number;
    /** 昵称 */
    nickname: string;
    /** @cqhttp cqhttp方法用 */
    flag: string;
    seq: number;
    time: number;
    /** 快速操作方法 */
    approve(yes?: boolean): Promise<boolean>;
}
/** 好友申请 */
export interface FriendRequestEvent extends RequestEvent {
    request_type: "friend";
    /** 为single时对方已将你加为单向好友 */
    sub_type: "add" | "single";
    /** 请求消息 */
    comment: string;
    /** 申请来源 */
    source: string;
    /** 年龄 */
    age: number;
    /** 性别 */
    sex: Gender;
}
/** 群申请 */
export interface GroupRequestEvent extends RequestEvent {
    request_type: "group";
    sub_type: "add";
    /** 群号 */
    group_id: number;
    /** 群名 */
    group_name: string;
    /** 群简介 */
    comment: string;
    /** 如果被邀请进群，则显示邀请者账号 */
    inviter_id?: number;
    /** 申请提示 @todo 不确定的注释 */
    tips: string;
}
/** 群邀请 */
export interface GroupInviteEvent extends RequestEvent {
    request_type: "group";
    sub_type: "invite";
    /** 群号 */
    group_id: number;
    /** 群名 */
    group_name: string;
    /** 邀请者在群里的权限 @todo 不确定的注释 */
    role: GroupRole;
}
/** 好友通知共通属性 */
export interface FriendNoticeEvent {
    post_type: "notice";
    notice_type: "friend";
    /** 对方账号 */
    user_id: number;
    /** 好友对象 */
    friend: Friend;
}
/** 好友增加 */
export interface FriendIncreaseEvent extends FriendNoticeEvent {
    sub_type: "increase";
    /** 好友昵称 */
    nickname: string;
}
/** 好友减少 */
export interface FriendDecreaseEvent extends FriendNoticeEvent {
    sub_type: "decrease";
    /** 好友昵称 */
    nickname: string;
}
/** 好友消息撤回 */
export interface FriendRecallEvent extends FriendNoticeEvent {
    sub_type: "recall";
    /** 好友账号 */
    operator_id: number;
    /** @cqhttp cqhttp方法用 */
    message_id: string;
    seq: number;
    rand: number;
    time: number;
}
/** 好友戳一戳 */
export interface FriendPokeEvent extends FriendNoticeEvent {
    sub_type: "poke";
    /** 好友账号 */
    operator_id: number;
    /** 目标账号 */
    target_id: number;
    /** 戳一戳动作 */
    action: string;
    /** @todo 未知字段 */
    suffix: string;
}
/** 群通知共通属性 */
export interface GroupNoticeEvent {
    post_type: "notice";
    notice_type: "group";
    /** 群号 */
    group_id: number;
    /** 群对象 */
    group: Group;
}
/** 群打卡 */
export interface GroupSignEvent extends GroupNoticeEvent {
    sub_type: "sign";
    /** 群号 */
    group_id: number;
    /** 打卡者账号 */
    user_id: number;
    /** 打卡者昵称 */
    nickname: string;
    /** 打卡提示 */
    sign_text: string;
}
/** 群员增加 */
export interface MemberIncreaseEvent extends GroupNoticeEvent {
    sub_type: "increase";
    /** 群员账号 */
    user_id: number;
    /** 群员昵称 */
    nickname: string;
}
/** 群员减少 */
export interface MemberDecreaseEvent extends GroupNoticeEvent {
    sub_type: "decrease";
    /** 主动退群为群员账号，被管理员/群主踢出为管理员/群主账号 */
    operator_id: number;
    /** 群员账号 */
    user_id: number;
    /** 如果是群主退群，则群解散 */
    dismiss: boolean;
    /** 退群的群员信息 */
    member?: MemberInfo;
}
/** 群消息撤回 */
export interface GroupRecallEvent extends GroupNoticeEvent {
    sub_type: "recall";
    /** 群员账号 */
    user_id: number;
    /** 撤回消息的群员账号 */
    operator_id: number;
    /** @cqhttp cqhttp方法用 */
    message_id: string;
    seq: number;
    rand: number;
    time: number;
}
/** 群戳一戳 */
export interface GroupPokeEvent extends GroupNoticeEvent {
    sub_type: "poke";
    /** @deprecated 群中该值永远等于target_id */
    user_id: number;
    /** 群员账号 */
    operator_id: number;
    /** 目标账号 */
    target_id: number;
    /** 戳一戳动作 */
    action: string;
    /** @todo 未知字段 */
    suffix: string;
}
/** 管理员变更 */
export interface GroupAdminEvent extends GroupNoticeEvent {
    sub_type: "admin";
    /** 变更的群员账号 */
    user_id: number;
    /** 是否设置为管理员 */
    set: boolean;
}
/** 群禁言 */
export interface GroupMuteEvent extends GroupNoticeEvent {
    sub_type: "ban";
    /** 禁言的群员账号 */
    operator_id: number;
    /** 被禁言的群员账号 */
    user_id: number;
    /** 禁言时长 */
    duration: number;
    /** 匿名禁言才有此属性 */
    nickname?: string;
}
/** 群转让 */
export interface GroupTransferEvent extends GroupNoticeEvent {
    sub_type: "transfer";
    /** 转让群的群员账号 */
    operator_id: number;
    /** 被转让为群主的账号 */
    user_id: number;
}
export type PushStrToNextStr<S extends string, NS extends string> = NS extends `${infer L}.${infer R}` ? `${L}.${S}.${R}` : `${NS}.${S}`;
export type MessageEventMap = {
    "message"(event: PrivateMessageEvent | GroupMessageEvent | DiscussMessageEvent): void;
    "message.discuss"(event: DiscussMessageEvent): void;
} & {
    [P in keyof PrivateMessageEventMap as PushStrToNextStr<"private", P>]: PrivateMessageEventMap[P];
} & {
    [P in keyof GroupMessageEventMap as PushStrToNextStr<"group", P>]: GroupMessageEventMap[P];
};
export type NoticeEventMap = {
    "notice"(...event: Parameters<MergeEventMap["notice.friend"]> | Parameters<MergeEventMap["notice.group"]>): void;
} & {
    [P in keyof FriendNoticeEventMap as PushStrToNextStr<"friend", P>]: FriendNoticeEventMap[P];
} & {
    [P in keyof GroupNoticeEventMap as PushStrToNextStr<"group", P>]: GroupNoticeEventMap[P];
};
export type RequestEventMap = {
    "request"(...event: Parameters<MergeEventMap["request.friend"]> | Parameters<MergeEventMap["request.group"]>): void;
} & {
    [P in keyof FriendRequestEventMap as PushStrToNextStr<"friend", P>]: FriendRequestEventMap[P];
} & {
    [P in keyof GroupRequestEventMap as PushStrToNextStr<"group", P>]: GroupRequestEventMap[P];
};
export type MergeEventMap = MessageEventMap & NoticeEventMap & RequestEventMap;
/** 事件字典 */
export interface EventMap extends MergeEventMap {
    /** 收到二维码 */
    "system.login.qrcode": (event: {
        image: Buffer;
    }) => void;
    /** 收到滑动验证码 */
    "system.login.slider": (event: {
        url: string;
    }) => void;
    /** 设备锁验证事件 */
    "system.login.device": (event: {
        url: string;
        phone: string;
    }) => void;
    /** 登录遇到错误 */
    "system.login.error": (event: {
        code: LoginErrorCode | number;
        message: string;
    }) => void;
    /** 上线事件 */
    "system.online": (event: undefined) => void;
    /** 下线事件（网络原因，默认自动重连） */
    "system.offline.network": (event: {
        message: string;
    }) => void;
    /** 下线事件（服务器踢） */
    "system.offline.kickoff": (event: {
        message: string;
    }) => void;
    /** 下线事件 */
    "system.offline": (event: {
        message: string;
    }) => void;
    /** 私聊同步 */
    "sync.message": (event: PrivateMessage) => void;
    /** 私聊消息已读同步 */
    "sync.read.private": (event: {
        user_id: number;
        time: number;
    }) => void;
    /** 群聊消息已读同步 */
    "sync.read.group": (event: {
        group_id: number;
        seq: number;
    }) => void;
    /** 消息已读同步 */
    "sync.read": (event: {
        user_id: number;
        time: number;
    } | {
        group_id: number;
        seq: number;
    }) => void;
    /** 隐藏事件: 监听所有收到的包 */
    "internal.sso": (cmd: string, payload: Buffer, seq: number) => void;
    /** 隐藏事件: 对方正在输入 */
    "internal.input": (event: {
        user_id: number;
        end: boolean;
    }) => void;
    /** 频道相关: 频道消息 */
    "message.guild": (event: GuildMessageEvent) => void;
    /** @todo 未知事件 */
    "send": (messageRet: MessageRet) => void;
}
