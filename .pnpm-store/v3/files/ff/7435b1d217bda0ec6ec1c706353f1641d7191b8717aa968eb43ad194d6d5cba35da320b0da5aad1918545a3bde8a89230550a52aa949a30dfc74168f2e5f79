/// <reference types="node" />
import { pb } from "./core";
import { Gender } from "./common";
import { Sendable, PrivateMessage, Quotable, FileElem } from "./message";
import { Contactable } from "./internal";
import { FriendDecreaseEvent, FriendIncreaseEvent, FriendPokeEvent, FriendRecallEvent, FriendRequestEvent, GroupInviteEvent, MessageRet, PrivateMessageEvent } from "./events";
import { FriendInfo } from "./entities";
type Client = import("./client").Client;
export interface User {
    /** 撤回消息 */
    recallMsg(msg: PrivateMessage): Promise<boolean>;
    recallMsg(msgid: string): Promise<boolean>;
    recallMsg(seq: number, rand: number, time: number): Promise<boolean>;
}
/** 用户 */
export declare class User extends Contactable {
    readonly uid: number;
    /** `this.uid`的别名 */
    get user_id(): number;
    static as(this: Client, uid: number): User;
    protected constructor(c: Client, uid: number);
    /** 返回作为好友的实例 */
    asFriend(strict?: boolean): Friend;
    /** 返回作为某群群员的实例 */
    asMember(gid: number, strict?: boolean): import("./member").Member;
    /**
     * 获取头像url
     * @param size 头像大小，默认`0`
     * @returns 头像的url地址
     */
    getAvatarUrl(size?: 0 | 40 | 100 | 140): string;
    getAddFriendSetting(): Promise<number>;
    /**
     * 点赞，支持陌生人点赞
     * @param times 点赞次数，默认1次
     */
    thumbUp(times?: number): Promise<boolean>;
    /** 查看资料 */
    getSimpleInfo(): Promise<{
        /** 账号 */
        user_id: number;
        /** 昵称 */
        nickname: string;
        /** 性别 */
        sex: Gender;
        /** 年龄 */
        age: number;
        /** 地区 */
        area: string;
    }>;
    /**
     * 获取`time`往前的`cnt`条聊天记录
     * @param time 默认当前时间，为时间戳的分钟数（`Date.now() / 1000`）
     * @param cnt 聊天记录条数，默认`20`，超过`20`按`20`处理
     * @returns 私聊消息列表，服务器记录不足`cnt`条则返回能获取到的最多消息记录
     */
    getChatHistory(time?: number, cnt?: number): Promise<PrivateMessage[]>;
    /**
     * 标记`time`之前为已读
     * @param time 默认当前时间，为时间戳的分钟数（`Date.now() / 1000`）
     */
    markRead(time?: number): Promise<void>;
    /**
     * 撤回消息，cqhttp方法用
     */
    recallMsg(param: number, rand: number, time: number): Promise<boolean>;
    /**
     * 撤回消息
     * @param message_id 消息id
     */
    recallMsg(message_id: string): Promise<boolean>;
    /**
     * 撤回消息
     * @param message 私聊消息对象
     */
    recallMsg(message: PrivateMessage): Promise<boolean>;
    private _getRouting;
    /**
     * 发送一条消息
     * @param content 消息内容
     * @param source 引用回复的消息
     */
    sendMsg(content: Sendable, source?: Quotable): Promise<MessageRet>;
    protected _sendMsg(proto3: pb.Encodable, brief: string, file?: boolean): Promise<MessageRet>;
    /**
     * 回添双向好友
     * @param seq 申请消息序号
     * @param remark 好友备注
     */
    addFriendBack(seq: number, remark?: string): Promise<boolean>;
    /**
     * 处理好友申请
     * @param seq 申请消息序号
     * @param yes 是否同意
     * @param remark 好友备注
     * @param block 是否屏蔽来自此用户的申请
     */
    setFriendReq(seq: number, yes?: boolean, remark?: string, block?: boolean): Promise<boolean>;
    /**
     * 处理入群申请
     * @param gid 群号
     * @param seq 申请消息序号
     * @param yes 是否同意
     * @param reason 若拒绝，拒绝的原因
     * @param block 是否屏蔽来自此用户的申请
     */
    setGroupReq(gid: number, seq: number, yes?: boolean, reason?: string, block?: boolean): Promise<boolean>;
    /**
     * 处理群邀请
     * @param gid 群号
     * @param seq 申请消息序号
     * @param yes 是否同意
     * @param block 是否屏蔽来自此群的邀请
     */
    setGroupInvite(gid: number, seq: number, yes?: boolean, block?: boolean): Promise<boolean>;
    /**
     * 获取文件信息
     * @param fid 文件id
     */
    getFileInfo(fid: string): Promise<Omit<FileElem, "type"> & Record<"url", string>>;
    /**
     * 获取离线文件下载地址
     * @param fid 文件id
     */
    getFileUrl(fid: string): Promise<string>;
}
/** 私聊消息事件 */
export interface PrivateMessageEventMap {
    "message"(event: PrivateMessageEvent): void;
    /** 好友的消息 */
    "message.friend"(event: PrivateMessageEvent): void;
    /** 群临时对话 */
    "message.group"(event: PrivateMessageEvent): void;
    /** 其他途径 */
    "message.other"(event: PrivateMessageEvent): void;
    /** 我的设备 */
    "message.self"(event: PrivateMessageEvent): void;
}
/** 好友通知事件 */
export interface FriendNoticeEventMap {
    "notice"(event: FriendIncreaseEvent | FriendDecreaseEvent | FriendRecallEvent | FriendPokeEvent): void;
    /** 新增好友 */
    "notice.increase"(event: FriendIncreaseEvent): void;
    /** 好友减少 */
    "notice.decrease"(event: FriendDecreaseEvent): void;
    /** 撤回消息 */
    "notice.recall"(event: FriendRecallEvent): void;
    /** 戳一戳 */
    "notice.poke"(event: FriendPokeEvent): void;
}
/** 好友申请事件 */
export interface FriendRequestEventMap {
    "request"(event: FriendRequestEvent): void;
    /** 群邀请 */
    "request.invite"(event: GroupInviteEvent): void;
    /** 添加好友 */
    "request.add"(event: FriendRequestEvent): void;
    /** 单向好友 */
    "request.single"(event: FriendRequestEvent): void;
}
/** 所有的好友事件 */
export interface FriendEventMap extends PrivateMessageEventMap, FriendNoticeEventMap, FriendRequestEventMap {
}
/** 好友 */
export declare class Friend extends User {
    private _info?;
    static as(this: Client, uid: number, strict?: boolean): Friend;
    /** 好友资料 */
    get info(): FriendInfo | undefined;
    /** 昵称 */
    get nickname(): string | undefined;
    /** 性别 */
    get sex(): Gender | undefined;
    /** 备注 */
    get remark(): string | undefined;
    /** 分组id */
    get class_id(): number | undefined;
    /** 分组名 */
    get class_name(): string | undefined;
    protected constructor(c: Client, uid: number, _info?: FriendInfo | undefined);
    /** 设置备注 */
    setRemark(remark: string): Promise<void>;
    /** 设置分组(注意：如果分组id不存在也会成功) */
    setClass(id: number): Promise<void>;
    /** 戳一戳 */
    poke(self?: boolean): Promise<boolean>;
    /**
     * 删除好友
     * @param block 屏蔽此好友的申请，默认为`true`
     */
    delete(block?: boolean): Promise<boolean>;
    /**
     * 发送离线文件
     * @param file `string`表示从该本地文件路径获取，`Buffer`表示直接发送这段内容
     * @param filename 对方看到的文件名，`file`为`Buffer`时，若留空则自动以md5命名
     * @param callback 监控上传进度的回调函数，拥有一个"百分比进度"的参数
     * @returns 文件id(撤回时使用)
     */
    sendFile(file: string | Buffer | Uint8Array, filename?: string, callback?: (percentage: string) => void): Promise<string>;
    /**
     * 撤回离线文件
     * @param fid 文件id
     */
    recallFile(fid: string): Promise<boolean>;
    /**
     * 转发离线文件
     * @param fid 文件fid
     * @param group_id 群号，转发群文件时填写
     * @returns 转发成功后新文件的id
     */
    forwardFile(fid: string, group_id?: number): Promise<string>;
    /**
     * 查找机器人与这个人的共群
     * @returns
     */
    searchSameGroup(): Promise<any>;
}
export {};
