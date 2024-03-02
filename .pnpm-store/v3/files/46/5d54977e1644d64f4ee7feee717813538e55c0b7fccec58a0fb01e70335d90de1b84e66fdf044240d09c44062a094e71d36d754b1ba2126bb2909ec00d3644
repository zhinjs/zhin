/// <reference types="node" />
import * as log4js from "log4js";
import { BaseClient, Domain, Platform } from "./core";
import { Gender, OnlineStatus } from "./common";
import { FriendInfo, GroupInfo, MemberInfo, StrangerInfo } from "./entities";
import { EventMap, GroupInviteEvent, GroupMessageEvent, PrivateMessageEvent } from "./events";
import { Friend, User } from "./friend";
import { Discuss, Group } from "./group";
import { Member } from "./member";
import { Forwardable, ImageElem, Quotable, Sendable } from "./message";
import { Listener, Matcher, ToDispose } from "triptrap";
import { Guild } from "./guild";
import { Configuration } from "log4js";
/** 事件接口 */
export interface Client extends BaseClient {
    on<T extends keyof EventMap>(event: T, listener: EventMap[T]): ToDispose<this>;
    on<S extends Matcher>(event: S & Exclude<S, keyof EventMap>, listener: Listener): ToDispose<this>;
    once<T extends keyof EventMap>(event: T, listener: EventMap[T]): ToDispose<this>;
    once<S extends Matcher>(event: S & Exclude<S, keyof EventMap>, listener: Listener): ToDispose<this>;
    trap<T extends keyof EventMap>(event: T, listener: EventMap[T]): ToDispose<this>;
    trap<S extends Matcher>(event: S & Exclude<S, keyof EventMap>, listener: Listener): ToDispose<this>;
    trip<E extends keyof EventMap>(event: E, ...args: Parameters<EventMap[E]>): boolean;
    trip<S extends string | symbol>(event: S & Exclude<S, keyof EventMap>, ...args: any[]): boolean;
    trapOnce<T extends keyof EventMap>(event: T, listener: EventMap[T]): ToDispose<this>;
    trapOnce<S extends Matcher>(event: S & Exclude<S, keyof EventMap>, listener: Listener): ToDispose<this>;
    off<T extends keyof EventMap>(event: T): void;
    off<S extends Matcher>(event: S & Exclude<S, keyof EventMap>): void;
}
/** 一个客户端 */
export declare class Client extends BaseClient {
    /**
     * 得到一个群对象, 通常不会重复创建、调用
     * @param gid 群号
     * @param strict 严格模式，若群不存在会抛出异常
     * @returns 一个`Group`对象
     */
    readonly pickGroup: (gid: number, strict?: boolean | undefined) => Group;
    /**
     * 得到一个好友对象, 通常不会重复创建、调用
     * @param uid 好友账号
     * @param strict 严格模式，若好友不存在会抛出异常
     * @returns 一个`Friend`对象
     */
    readonly pickFriend: (uid: number, strict?: boolean | undefined) => Friend;
    /**
     * 得到一个群员对象, 通常不会重复创建、调用
     * @param gid 群员所在的群号
     * @param uid 群员的账号
     * @param strict 严格模式，若群员不存在会抛出异常
     * @returns 一个`Member`对象
     */
    readonly pickMember: (gid: number, uid: number, strict?: boolean | undefined) => Member;
    /**
     * 创建一个用户对象
     * @param uid 用户的账号
     * @returns 一个`User`对象
     */
    readonly pickUser: (uid: number) => User;
    /**
     * 创建一个讨论组对象
     * @param gid 讨论组号
     * @returns 一个`Discuss`对象
     */
    readonly pickDiscuss: (gid: number) => Discuss;
    /**
     * 创建一个频道对象，通常不会重复创建、调用
     * @param guild_id 频道号
     * @returns 一个`Guild`对象
     */
    readonly pickGuild: (guild_id: string) => Guild;
    /** 日志记录器，初始情况下是`log4js.Logger` */
    logger: Logger | log4js.Logger;
    /** 账号本地数据存储目录 */
    readonly dir: string;
    /** 配置 */
    readonly config: Required<Config>;
    protected readonly _cache: Map<number, Set<string>>;
    protected _sync_cookie?: Uint8Array;
    /** 密码的md5值，调用 {@link login} 后会保存在这里，用于`token`过期时恢复登录 */
    password_md5?: Buffer;
    get [Symbol.toStringTag](): string;
    /** 好友列表 */
    readonly fl: Map<number, FriendInfo>;
    /** 陌生人列表 */
    readonly sl: Map<number, StrangerInfo>;
    /** 群列表 */
    readonly gl: Map<number, GroupInfo>;
    /** 群员列表缓存 */
    readonly gml: Map<number, Map<number, MemberInfo>>;
    /** 我加入的频道列表 */
    readonly guilds: Map<string, Guild>;
    /** 黑名单列表 */
    readonly blacklist: Set<number>;
    /** 好友分组 */
    readonly classes: Map<number, string>;
    /** 勿手动修改这些属性 */
    /** 在线状态 */
    status: OnlineStatus;
    /** 昵称 */
    nickname: string;
    /** 性别 */
    sex: Gender;
    /** 年龄 */
    age: number;
    /** @todo 未知属性 */
    bid: string;
    /** 漫游表情缓存 */
    stamp: Set<string>;
    /** 相当于频道中的qq号 */
    tiny_id: string;
    /** csrf token */
    get bkn(): number;
    /** @todo 未知属性 */
    readonly cookies: {
        [domain in Domain]: string;
    };
    /** 数据统计 */
    get stat(): {
        start_time: number;
        lost_times: number;
        recv_pkt_cnt: number;
        sent_pkt_cnt: number;
        lost_pkt_cnt: number;
        recv_msg_cnt: number;
        sent_msg_cnt: number;
        msg_cnt_per_min: number;
        remote_ip: string;
        remote_port: number;
        ver: string;
    };
    /** 修改日志级别 */
    set log_level(level: LogLevel);
    /**
     * 继承原版`oicq`的构造方式，建议使用另一个构造函数
     * @param uin 账号
     * @param conf 配置
     */
    constructor(uin: number, conf?: Config);
    /**
     * 账号在调用 {@link login} 时传入
     * @param conf 配置
     */
    constructor(conf?: Config);
    /**
     * 只能在初始化Client时传了`uin`或扫码登录，才能调用
     * * 传了`password`则尝试密码登录
     * * 不传`password`则尝试扫码登录
     * 未传任何参数 则尝试扫码登录
     * 掉线重连时也是自动调用此函数，走相同逻辑
     * 你也可以在配置中修改`reconn_interval`，关闭掉线重连并自行处理
     * @param password 可以为密码原文，或密码的md5值
     */
    login(password?: string | Buffer): Promise<void>;
    /**
     * 传了`uin`，未传`password`
     * 会优先尝试使用token登录 (token在上次登录成功后存放在`this.dir`的`${uin}_token`中)
     * 传了`uin`无token或token失效时：
     * * 传了`password`则尝试密码登录
     * * 不传`password`则尝试扫码登录
     * 未传任何参数 则尝试扫码登录
     * 掉线重连时也是自动调用此函数，走相同逻辑
     * 你也可以在配置中修改`reconn_interval`，关闭掉线重连并自行处理
     * @param uin 登录账号
     * @param password 可以为密码原文，或密码的md5值
     */
    login(uin?: number, password?: string | Buffer): Promise<void>;
    /** 设置在线状态 */
    setOnlineStatus(status?: OnlineStatus.Online | OnlineStatus.Absent | OnlineStatus.Invisible | OnlineStatus.Busy | OnlineStatus.Qme | OnlineStatus.DontDisturb): Promise<boolean>;
    /** 设置昵称 */
    setNickname(nickname: string): Promise<boolean>;
    /**
     * 设置性别
     * @param gender 0：未知，1：男，2：女
     */
    setGender(gender: 0 | 1 | 2): Promise<boolean>;
    /**
     * 设置生日
     * @param birthday `YYYYMMDD`格式的`string`（会过滤非数字字符）或`number`
     * */
    setBirthday(birthday: string | number): Promise<boolean>;
    /** 设置个人说明 */
    setDescription(description?: string): Promise<boolean>;
    /** 设置个性签名 */
    setSignature(signature?: string): Promise<boolean>;
    /** 获取个性签名 */
    getSignature(): Promise<string>;
    /** 设置头像 */
    setAvatar(file: ImageElem["file"]): Promise<void>;
    /** 获取漫游表情 */
    getRoamingStamp(no_cache?: boolean): Promise<string[]>;
    /** 删除表情(支持批量) */
    deleteStamp(id: string | string[]): Promise<void>;
    /** 获取系统消息 */
    getSystemMsg(): Promise<(import("./events").FriendRequestEvent | GroupInviteEvent | import("./events").GroupRequestEvent)[]>;
    /** 添加好友分组 */
    addClass(name: string): Promise<void>;
    /** 删除好友分组 */
    deleteClass(id: number): Promise<void>;
    /** 重命名好友分组 */
    renameClass(id: number, name: string): Promise<void>;
    /** 重载好友列表 */
    reloadFriendList(): Promise<void>;
    /** 重载陌生人列表 */
    reloadStrangerList(): Promise<void>;
    /** 重新加载频道列表 */
    reloadGuilds(): Promise<void>;
    /** 重载群列表 */
    reloadGroupList(): Promise<void>;
    /** 重载黑名单 */
    reloadBlackList(): Promise<void>;
    /** 清空缓存文件 fs.rm need v14.14 */
    cleanCache(): void;
    /**
     * 获取视频下载地址
     * use {@link Friend.getVideoUrl}
     */
    getVideoUrl(fid: string, md5: string | Buffer): Promise<string>;
    /**
     * 获取转发消息
     * use {@link Friend.getForwardMsg}
     */
    getForwardMsg(resid: string, fileName?: string, nt?: boolean): Promise<import("./message").ForwardMessage[]>;
    /**
     * 制作转发消息
     * use {@link Friend.makeForwardMsg} or {@link Group.makeForwardMsg}
     */
    makeForwardMsg(fake: Forwardable[], dm?: boolean, nt?: boolean): Promise<import("./message").JsonElem>;
    /** Ocr图片转文字 */
    imageOcr(file: ImageElem["file"]): Promise<import("./internal").OcrResult>;
    /** @cqhttp (cqhttp遗留方法) use {@link cookies[domain]} */
    getCookies(domain?: Domain): string;
    /** @cqhttp use {@link bkn} */
    getCsrfToken(): number;
    /** @cqhttp use {@link fl} */
    getFriendList(): Map<number, FriendInfo>;
    /** @cqhttp use {@link gl} */
    getGroupList(): Map<number, GroupInfo>;
    /** @cqhttp use {@link guilds} */
    getGuildList(): {
        guild_id: string;
        guild_name: string;
    }[];
    /** @cqhttp use {@link Guild.info} */
    getGuildInfo(guild_id: string): {
        guild_id: string;
        guild_name: string;
    } | null;
    getChannelInfo(guild_id: string, channel_id: string): {
        guild_id: string;
        channel_id: string;
        channel_name: string;
        channel_type: import("./channel").ChannelType;
    } | null;
    /**
     * 添加群精华消息
     * use {@link Group.addEssence}
     * @param message_id 消息id
     */
    setEssenceMessage(message_id: string): Promise<string>;
    /**
     * 移除群精华消息
     * use {@link Group.removeEssence}
     * @param message_id 消息id
     */
    removeEssenceMessage(message_id: string): Promise<string>;
    /**
     * 获取子频道列表
     * use {@link Guild.channels}
     */
    getChannelList(guild_id: string): {
        guild_id: string;
        channel_id: string;
        channel_name: string;
        channel_type: import("./channel").ChannelType;
    }[];
    /**
     * 获取频道成员列表
     * use {@link Guild.getMemberList}
     */
    getGuildMemberList(guild_id: string): never[] | Promise<import("./guild").GuildMember[]>;
    /** @cqhttp use {@link sl} */
    getStrangerList(): Map<number, StrangerInfo>;
    /** @cqhttp use {@link User.getSimpleInfo} */
    getStrangerInfo(user_id: number): Promise<{
        user_id: number; /** 黑名单列表 */
        nickname: string;
        sex: Gender;
        age: number;
        area: string; /** 漫游表情缓存 */
    }>;
    /** @cqhttp use {@link Group.info} or {@link Group.renew} */
    getGroupInfo(group_id: number, no_cache?: boolean): Promise<GroupInfo>;
    /** @cqhttp use {@link Group.getMemberMap} */
    getGroupMemberList(group_id: number, no_cache?: boolean): Promise<Map<number, MemberInfo>>;
    /** @cqhttp use {@link Member.info} or {@link Member.renew} */
    getGroupMemberInfo(group_id: number, user_id: number, no_cache?: boolean): Promise<MemberInfo>;
    /** @cqhttp use {@link Friend.sendMsg} */
    sendPrivateMsg(user_id: number, message: Sendable, source?: Quotable): Promise<import("./events").MessageRet>;
    /** @cqhttp use {@link Guild.sendMsg} */
    sendGuildMsg(guild_id: string, channel_id: string, message: Sendable): Promise<import("./internal").GuildMessageRet>;
    /** @cqhttp use {@link Group.sendMsg} */
    sendGroupMsg(group_id: number, message: Sendable, source?: Quotable): Promise<import("./events").MessageRet>;
    /** @cqhttp use {@link Group.sign} */
    sendGroupSign(group_id: number): Promise<{
        result: number;
    }>;
    /** @cqhttp use {@link Discuss.sendMsg} */
    sendDiscussMsg(discuss_id: number, message: Sendable, source?: Quotable): Promise<import("./events").MessageRet>;
    /** @cqhttp use {@link Member.sendMsg} */
    sendTempMsg(group_id: number, user_id: number, message: Sendable): Promise<import("./events").MessageRet>;
    /** @cqhttp use {@link User.recallMsg} or {@link Group.recallMsg} */
    deleteMsg(message_id: string): Promise<boolean>;
    /** @cqhttp use {@link User.markRead} or {@link Group.markRead} */
    reportReaded(message_id: string): Promise<void>;
    /** @cqhttp use {@link User.getChatHistory} or {@link Group.getChatHistory} */
    getMsg(message_id: string): Promise<import("./message").GroupMessage | import("./message").PrivateMessage | undefined>;
    /** @cqhttp use {@link User.getChatHistory} or {@link Group.getChatHistory} */
    getChatHistory(message_id: string, count?: number): Promise<import("./message").PrivateMessage[] | import("./message").GroupMessage[]>;
    /** @cqhttp use {@link Group.muteAnony} */
    setGroupAnonymousBan(group_id: number, flag: string, duration?: number): Promise<void>;
    /** @cqhttp use {@link Group.allowAnony} */
    setGroupAnonymous(group_id: number, enable?: boolean): Promise<boolean>;
    /** @cqhttp use {@link Group.muteAll} */
    setGroupWholeBan(group_id: number, enable?: boolean): Promise<boolean>;
    /**
     * 设置当前群成员消息屏蔽状态
     * @param group_id {number} 群号
     * @param member_id {number} 成员QQ号
     * @param isScreen {boolean} 是否屏蔽 默认true
     */
    setGroupMemberScreenMsg(group_id: number, member_id: number, isScreen?: boolean): Promise<boolean>;
    /** @cqhttp use {@link Group.setName} */
    setGroupName(group_id: number, name: string): Promise<boolean>;
    /** @cqhttp use {@link Group.announce} */
    sendGroupNotice(group_id: number, content: string): Promise<boolean>;
    /** @cqhttp use {@link Group.setAdmin} or {@link Member.setAdmin} */
    setGroupAdmin(group_id: number, user_id: number, enable?: boolean): Promise<boolean>;
    /** @cqhttp use {@link Group.setTitle} or {@link Member.setTitle} */
    setGroupSpecialTitle(group_id: number, user_id: number, special_title: string, duration?: number): Promise<boolean>;
    /** @cqhttp use {@link Group.setCard} or {@link Member.setCard} */
    setGroupCard(group_id: number, user_id: number, card: string): Promise<boolean>;
    /** @cqhttp use {@link Group.kickMember} or {@link Member.kick} */
    setGroupKick(group_id: number, user_id: number, reject_add_request?: boolean, message?: string): Promise<boolean>;
    /** @cqhttp use {@link Group.muteMember} or {@link Member.mute} */
    setGroupBan(group_id: number, user_id: number, duration?: number): Promise<void>;
    /** @cqhttp use {@link Group.quit} */
    setGroupLeave(group_id: number): Promise<boolean>;
    /** @cqhttp use {@link Group.pokeMember} or {@link Member.poke} */
    sendGroupPoke(group_id: number, user_id: number): Promise<boolean>;
    /** @cqhttp use {@link Member.addFriend} */
    addFriend(group_id: number, user_id: number, comment?: string): Promise<boolean>;
    /** @cqhttp use {@link Friend.delete} */
    deleteFriend(user_id: number, block?: boolean): Promise<boolean>;
    /** @cqhttp use {@link Group.invite} */
    inviteFriend(group_id: number, user_id: number): Promise<boolean>;
    /** @cqhttp use {@link Friend.thumbUp} */
    sendLike(user_id: number, times?: number): Promise<boolean>;
    /** @cqhttp use {@link setAvatar} */
    setPortrait(file: Parameters<Client["setAvatar"]>[0]): Promise<void>;
    /** @cqhttp use {@link Group.setAvatar} */
    setGroupPortrait(group_id: number, file: Parameters<Group["setAvatar"]>[0]): Promise<void>;
    /** @cqhttp use {@link Group.fs} */
    acquireGfs(group_id: number): import("./gfs").Gfs;
    /** @cqhttp use {@link User.setFriendReq} or {@link User.addFriendBack} */
    setFriendAddRequest(flag: string, approve?: boolean, remark?: string, block?: boolean): Promise<boolean>;
    /** @cqhttp use {@link User.setGroupInvite} or {@link User.setGroupReq} */
    setGroupAddRequest(flag: string, approve?: boolean, reason?: string, block?: boolean): Promise<boolean>;
    /**
     * 监听群邀请/消息事件
     * @param group_ids 监听群的群号
     * @returns 事件处理
     */
    group(...group_ids: number[]): (listener: (event: GroupInviteEvent | GroupMessageEvent) => void) => ToDispose<this>;
    /**
     * 监听用户私聊/群聊事件
     * @param user_ids 监听的用户账号
     * @returns 事件处理
     */
    user(...user_ids: number[]): (listener: (event: PrivateMessageEvent | GroupMessageEvent) => void) => ToDispose<this>;
    /** emit an event */
    em(name?: string, data?: any): void;
    protected _msgExists(from: number, type: number, seq: number, time: number): boolean;
    protected _calcMsgCntPerMin(): number;
    private _setProfile;
    /** @deprecated use {@link submitSlider} */
    sliderLogin(ticket: string): Promise<void>;
    /** @deprecated use {@link sendSmsCode} */
    sendSMSCode(): Promise<void>;
    /** @deprecated use {@link submitSmsCode} */
    submitSMSCode(code: string): Promise<void>;
    /** @deprecated use {@link status} */
    get online_status(): OnlineStatus;
}
/** 日志等级 */
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "mark" | "off";
export type LogLevelMap = {
    [key in LogLevel]: number;
};
export type LoggerFn = {
    [key in LogLevel]: (...args: any[]) => any;
};
export interface Logger extends LoggerFn {
    level?: LogLevel;
}
/** 配置项 */
export interface Config {
    /**
     * 日志等级，默认`info`
     * 打印日志会降低性能，若消息量巨大建议修改此参数
     */
    log_level?: LogLevel;
    /** 登录设备，默认为安卓手机 */
    platform?: Platform;
    /** 使用版本，仅在对应platform中有多个版本是有效，不填则使用最新版本 */
    ver?: string;
    /** log4js配置 */
    log_config?: Configuration | string;
    /** 群聊和频道中过滤自己的消息，默认`true` */
    ignore_self?: boolean;
    /** 被风控时是否尝试用分片发送，默认`true` */
    resend?: boolean;
    /** 数据存储文件夹，需要可写权限，默认主模块下的data文件夹 */
    data_dir?: string;
    /**
     * 触发`system.offline.network`事件后的重新登录间隔秒数，默认5(秒)，不建议设置过低
     * 设置为0则不会自动重连，然后你可以监听此事件自己处理
     */
    reconn_interval?: number;
    /**
     * 签名服务器地址，未配置可能会导致登录失败和无法收发消息
     */
    sign_api_addr?: string;
    /** 是否缓存群员列表(默认true)，群多的时候(500~1000)会多占据约100MB+内存，关闭后进程只需不到20MB内存 */
    cache_group_member?: boolean;
    /** 自动选择最优服务器(默认true)，关闭后会一直使用`msfwifi.3g.qq.com:8080`进行连接 */
    auto_server?: boolean;
    /** ffmpeg */
    ffmpeg_path?: string;
    ffprobe_path?: string;
}
/** 数据统计 */
export type Statistics = Client["stat"];
/** 创建一个客户端 (=new Client) */
export declare function createClient(config?: Config): Client;
