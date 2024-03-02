/// <reference types="node" />
import { pb } from "../core";
import { MessageElem, Sendable } from "../message";
type Client = import("../client").Client;
/** 频道发消息的返回值 */
export interface GuildMessageRet {
    seq: number;
    rand: number;
    time: number;
}
/** 频道消息事件 */
export declare class GuildMessageEvent {
    /** 频道id */
    guild_id: string;
    /** 频道名 */
    guild_name: string;
    /** 子频道id */
    channel_id: string;
    /** 子频道名 */
    channel_name: string;
    post_type: 'message';
    detail_type: string;
    /** 消息序号（同一子频道中一般顺序递增） */
    seq: number;
    rand: number;
    time: number;
    /** 消息内容 */
    message: MessageElem[];
    raw_message: string;
    /** 发送方信息 */
    sender: {
        /** 账号 */
        tiny_id: string;
        /** 昵称 */
        nickname: string;
    };
    constructor(proto: pb.Proto);
    /** 暂时仅支持发送： 文本、AT、表情 */
    reply: (content: Sendable) => Promise<GuildMessageRet>;
}
export declare function guildMsgListener(this: Client, payload: Buffer): void;
export {};
