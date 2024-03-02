import { Client } from "./client";
import { pb } from "./core";
import { Channel } from "./channel";
import { Sendable } from "./message";
/** 频道权限 */
export declare enum GuildRole {
    /** 成员 */
    Member = 1,
    /** 频道管理员 */
    GuildAdmin = 2,
    /** 频道主 */
    Owner = 4,
    /** 子频道管理员 */
    ChannelAdmin = 5
}
/** 频道成员 */
export interface GuildMember {
    /** 账号 */
    tiny_id: string;
    /** 名片 */
    card: string;
    /** 昵称 */
    nickname: string;
    /** 权限 */
    role: GuildRole;
    /** 加入时间 */
    join_time: number;
}
/** 频道 */
export declare class Guild {
    readonly c: Client;
    readonly guild_id: string;
    /** 频道名 */
    guild_name: string;
    /** 子频道字典 */
    channels: Map<string, Channel>;
    constructor(c: Client, guild_id: string);
    static as(this: Client, guild_id: string): Guild;
    /**
     * 发送消息
     * @param channel_id 子频道id
     * @param message 消息内容
     */
    sendMsg(channel_id: string, message: Sendable): Promise<import("./internal").GuildMessageRet>;
    _renew(guild_name: string, proto: pb.Proto | pb.Proto[]): void;
    /** 获取频道成员列表 */
    getMemberList(): Promise<GuildMember[]>;
}
