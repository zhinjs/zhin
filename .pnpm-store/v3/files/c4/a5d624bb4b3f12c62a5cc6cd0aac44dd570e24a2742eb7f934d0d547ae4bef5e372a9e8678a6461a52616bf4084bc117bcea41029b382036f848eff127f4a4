/// <reference types="node" />
import { Contactable } from "./internal";
import { Sendable, GroupMessage, ImageElem, Anonymous, Quotable } from "./message";
import { Gfs } from "./gfs";
import { DiscussMessageEvent, GroupAdminEvent, GroupInviteEvent, GroupSignEvent, GroupMessageEvent, GroupMuteEvent, GroupPokeEvent, GroupRecallEvent, GroupRequestEvent, GroupTransferEvent, MemberDecreaseEvent, MemberIncreaseEvent, MessageRet } from "./events";
import { GroupInfo, MemberInfo } from "./entities";
type Client = import("./client").Client;
export declare namespace Discuss {
    interface EventMap {
        message(e: DiscussMessageEvent): void;
    }
}
/** 讨论组 */
export declare class Discuss extends Contactable {
    readonly gid: number;
    static as(this: Client, gid: number): Discuss;
    /** {@link gid} 的别名 */
    get group_id(): number;
    protected constructor(c: Client, gid: number);
    /** 发送一条消息 */
    sendMsg(content: Sendable): Promise<MessageRet>;
}
/** 群聊消息事件 */
export interface GroupMessageEventMap {
    "message"(event: GroupMessageEvent): void;
    /** 普通消息 */
    "message.normal"(event: GroupMessageEvent): void;
    /** 匿名消息 */
    "message.anonymous"(event: GroupMessageEvent): void;
}
/** 群聊通知事件 */
export interface GroupNoticeEventMap {
    "notice"(event: MemberIncreaseEvent | GroupSignEvent | MemberDecreaseEvent | GroupRecallEvent | GroupAdminEvent | GroupMuteEvent | GroupTransferEvent | GroupPokeEvent): void;
    /** 群员新增 */
    "notice.increase"(event: MemberIncreaseEvent): void;
    /** 群员减少 */
    "notice.decrease"(event: MemberDecreaseEvent): void;
    /** 消息撤回 */
    "notice.recall"(event: GroupRecallEvent): void;
    /** 管理员变更 */
    "notice.admin"(event: GroupAdminEvent): void;
    /** 群禁言 */
    "notice.ban"(event: GroupMuteEvent): void;
    /** 群打卡 */
    "notice.sign"(event: GroupSignEvent): void;
    /** 群转让 */
    "notice.transfer"(event: GroupTransferEvent): void;
    /** 戳一戳 */
    "notice.poke"(event: GroupPokeEvent): void;
}
/** 群聊申请事件 */
export interface GroupRequestEventMap {
    "request"(event: GroupRequestEvent | GroupInviteEvent): void;
    /** 加群申请 */
    "request.add"(event: GroupRequestEvent): void;
    /** 群邀请 */
    "request.invite"(event: GroupInviteEvent): void;
}
/** 所有的群聊事件 */
export interface GroupEventMap extends GroupMessageEventMap, GroupNoticeEventMap, GroupRequestEventMap {
}
/** 群 */
export interface Group {
    /** 撤回消息 */
    recallMsg(msg: GroupMessage): Promise<boolean>;
    recallMsg(msgid: string): Promise<boolean>;
    recallMsg(seq: number, rand: number, pktnum?: number): Promise<boolean>;
}
/** 群 */
export declare class Group extends Discuss {
    private _info?;
    static as(this: Client, gid: number, strict?: boolean): Group;
    /** 群资料 */
    get info(): GroupInfo | undefined;
    /** 群名 */
    get name(): string | undefined;
    /** 我是否是群主 */
    get is_owner(): boolean;
    /** 我是否是管理 */
    get is_admin(): boolean;
    /** 是否全员禁言 */
    get all_muted(): boolean;
    /** 我的禁言剩余时间 */
    get mute_left(): number;
    /** 群文件系统 */
    readonly fs: Gfs;
    protected constructor(c: Client, gid: number, _info?: GroupInfo | undefined);
    /**
     * 获取群员实例
     * @param uid 群员账号
     * @param strict 严格模式，若群员不存在会抛出异常
     */
    pickMember(uid: number, strict?: boolean): import("./member").Member;
    /**
     * 获取群头像url
     * @param size 头像大小，默认`0`
     * @param history 历史头像记录，默认`0`，若要获取历史群头像则填写1,2,3...
     * @returns 头像的url地址
     */
    getAvatarUrl(size?: 0 | 40 | 100 | 140, history?: number): string;
    /** 强制刷新群资料 */
    renew(): Promise<GroupInfo>;
    private _fetchMembers;
    /** 获取群员列表 */
    getMemberMap(no_cache?: boolean): Promise<Map<number, MemberInfo>>;
    /**
     * 添加精华消息
     * @param seq 消息序号
     * @param rand 消息的随机值
     */
    addEssence(seq: number, rand: number): Promise<string>;
    /**
     * 移除精华消息
     * @param seq 消息序号
     * @param rand 消息的随机值
     */
    removeEssence(seq: number, rand: number): Promise<string>;
    /**
     * 发送一个文件
     * @param file `string`表示从该本地文件路径上传，`Buffer`表示直接上传这段内容
     * @param pid 上传的目标目录id，默认根目录
     * @param name 上传的文件名，`file`为`Buffer`时，若留空则自动以md5命名
     * @param callback 监控上传进度的回调函数，拥有一个"百分比进度"的参数
     * @returns 上传的文件属性
     */
    sendFile(file: string | Buffer | Uint8Array, pid?: string, name?: string, callback?: (percentage: string) => void): Promise<import("./gfs").GfsFileStat>;
    /**
     * 发送一条消息
     * @param content 消息内容
     * @param source 引用回复的消息
     * @param anony 是否匿名
     */
    sendMsg(content: Sendable, source?: Quotable, anony?: Omit<Anonymous, "flag"> | boolean): Promise<MessageRet>;
    private _sendMsgByFrag;
    /**
     * 设置当前群成员消息屏蔽状态
     * @param member_id
     * @param isScreen
     */
    setScreenMemberMsg(member_id: number, isScreen?: boolean): Promise<boolean>;
    /**
     * 撤回消息，cqhttp方法用
     */
    recallMsg(param: number, rand: number, pktnum: number): Promise<boolean>;
    /**
     * 撤回消息
     * @param message_id 消息id
     */
    recallMsg(message_id: string): Promise<boolean>;
    /**
     * 撤回消息
     * @param message 群聊消息对象
     */
    recallMsg(message: GroupMessage): Promise<boolean>;
    /** 设置群名 */
    setName(name: string): Promise<boolean>;
    /** 全员禁言 */
    muteAll(yes?: boolean): Promise<boolean>;
    /** 发送简易群公告 */
    announce(content: string): Promise<boolean>;
    private _setting;
    /** 允许/禁止匿名 */
    allowAnony(yes?: boolean): Promise<boolean>;
    /** 设置群备注 */
    setRemark(remark?: string): Promise<void>;
    /** 禁言匿名群员，默认1800秒 */
    muteAnony(flag: string, duration?: number): Promise<void>;
    /** 获取自己的匿名情报 */
    getAnonyInfo(): Promise<Omit<Anonymous, "flag">>;
    /** 获取 @全体成员 的剩余次数 */
    getAtAllRemainder(): Promise<number>;
    private _getLastSeq;
    /**
     * 标记`seq`之前的消息为已读
     * @param seq 消息序号，默认为`0`，表示标记所有消息
     */
    markRead(seq?: number): Promise<void>;
    /**
     * 获取`seq`之前的`cnt`条聊天记录，默认从最后一条发言往前，`cnt`默认20不能超过20
     * @param seq 消息序号，默认为`0`，表示从最后一条发言往前
     * @param cnt 聊天记录条数，默认`20`，超过`20`按`20`处理
     * @returns 群聊消息列表，服务器记录不足`cnt`条则返回能获取到的最多消息记录
     */
    getChatHistory(seq?: number, cnt?: number): Promise<GroupMessage[]>;
    /**
     * 获取群文件下载地址
     * @param fid 文件id
     */
    getFileUrl(fid: string): Promise<string>;
    /** 设置群头像 */
    setAvatar(file: ImageElem["file"]): Promise<void>;
    /**
     * 邀请好友入群
     * @param uid 好友账号
     */
    invite(uid: number): Promise<boolean>;
    /** 打卡 */
    sign(): Promise<{
        result: number;
    }>;
    /** 退群，若为群主则解散该群 */
    quit(): Promise<boolean>;
    /**
     * 设置管理员，use {@link Member.setAdmin}
     * @param uid 群员账号
     * @param yes 是否设为管理员
     */
    setAdmin(uid: number, yes?: boolean): Promise<boolean>;
    /**
     * 设置头衔，use {@link Member.setTitle}
     * @param uid 群员账号
     * @param title 头衔名
     * @param duration 持续时间，默认`-1`，表示永久
     */
    setTitle(uid: number, title?: string, duration?: number): Promise<boolean>;
    /**
     * 设置名片，use {@link Member.setCard}
     * @param uid 群员账号
     * @param card 名片
     */
    setCard(uid: number, card?: string): Promise<boolean>;
    /**
     * 踢出此群，use {@link Member.kick}
     * @param uid 群员账号
     * @param msg @todo 未知参数
     * @param block 是否屏蔽群员
     */
    kickMember(uid: number, msg?: string, block?: boolean): Promise<boolean>;
    /**
     * 禁言群员，use {@link Member.mute}
     * @param uid 群员账号
     * @param duration 禁言时长（秒），默认`600`
     */
    muteMember(uid: number, duration?: number): Promise<void>;
    /**
     * 戳一戳
     * @param uid 群员账号
     */
    pokeMember(uid: number): Promise<boolean>;
    /**
     * 获取群内被禁言人
     * @returns
     */
    getMuteMemberList(): Promise<({
        uin: number | null;
        unMuteTime: string | null;
    } | null)[]>;
}
export {};
