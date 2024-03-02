/// <reference types="node" />
import { pb } from "../core";
import { GroupRole, Gender } from "../common";
import { Parser } from "./parser";
import { Quotable, Forwardable, MessageElem } from "./elements";
/** 匿名情报 */
export interface Anonymous {
    /** 是否可以匿名发言 */
    enable: boolean;
    flag: string;
    id: number;
    id2: number;
    name: string;
    expire_time: number;
    color: string;
}
export declare function rand2uuid(rand: number): bigint;
export declare function uuid2rand(uuid: bigint): number;
/** @cqhttp 生成私聊消息id */
export declare function genDmMessageId(uid: number, seq: number, rand: number, time: number, flag?: number): string;
/** @cqhttp 解析私聊消息id */
export declare function parseDmMessageId(msgid: string): {
    user_id: number;
    seq: number;
    rand: number;
    time: number;
    flag: number;
};
/** @cqhttp 生成群消息id */
export declare function genGroupMessageId(gid: number, uid: number, seq: number, rand: number, time: number, pktnum?: number): string;
/** @cqhttp 解析群消息id */
export declare function parseGroupMessageId(msgid: string): {
    group_id: number;
    user_id: number;
    seq: number;
    rand: number;
    time: number;
    pktnum: number;
};
/** 一条消息 */
export declare abstract class Message implements Quotable, Forwardable {
    protected proto: pb.Proto;
    protected readonly parsed: Parser;
    /**
     * 该值永远指向消息发送者。
     * 对于私聊消息，请使用`from_id`和`to_id`来确定发送者和接收者。
     * 建议使用 `sender.user_id`
     * @deprecated 未来会改为访问器，仅供内部转发消息时使用。
     */
    user_id: number;
    /** 发送方昵称，仅供内部转发消息时使用 */
    get nickname(): string;
    post_type: "message";
    /** 消息时间 */
    time: number;
    /** 消息元素数组 */
    message: MessageElem[];
    /** 字符串形式的消息 */
    raw_message: string;
    font: string;
    /** @cqhttp cqhttp方法用 */
    message_id: string;
    /** 消息编号，在群消息中是唯一的 (私聊消息建议至少使用time,seq,rand中的两个判断唯一性) */
    seq: number;
    /** 消息随机数 */
    rand: number;
    /** 发送方 */
    sender?: {
        [k: string]: any;
    };
    /** 引用回复 */
    source?: Quotable;
    pktnum: number;
    index: number;
    div: number;
    /** 反序列化一条消息 (私聊消息需要你的uin) */
    static deserialize(serialized: Buffer, uin?: number): GroupMessage | DiscussMessage | PrivateMessage;
    /** 组合分片消息(通常仅内部使用) */
    static combine(msgs: Message[]): Message;
    constructor(proto: pb.Proto);
    /** 将消息序列化保存 */
    serialize(): Buffer;
    /** 以适合人类阅读的形式输出 */
    toString(): string;
    toJSON(keys: string[]): Record<string, any>;
    /** @deprecated 转换为CQ码 */
    toCqcode(): string;
}
/** 一条私聊消息 */
export declare class PrivateMessage extends Message {
    message_type: "private";
    /**
     * @type {"friend"} 好友
     * @type {"group"} 群临时会话
     * @type {"other"} 其他途径的临时会话
     * @type {"self"} 我的设备
     */
    sub_type: "friend" | "group" | "other" | "self";
    /** 发送方账号 */
    from_id: number;
    /** 接收方账号 */
    to_id: number;
    /** 是否为自动回复 */
    auto_reply: boolean;
    /** 发送方信息 */
    sender: {
        /** 账号 */
        user_id: number;
        /** 昵称 */
        nickname: string;
        /** 群号，当消息来自群聊时有效 */
        group_id: number | undefined;
        /** 讨论组号，当消息来自讨论组时有效 */
        discuss_id: number | undefined;
    };
    /** 反序列化一条私聊消息，你需要传入你的`uin`，否则无法知道你是发送者还是接收者 */
    static deserialize(serialized: Buffer, uin?: number): PrivateMessage;
    constructor(proto: pb.Proto, uin?: number);
}
/** 一条群消息 */
export declare class GroupMessage extends Message {
    message_type: "group";
    /**
     * @type {"normal"} 普通消息
     * @type {"anonymous"} 匿名消息
     */
    sub_type: "normal" | "anonymous";
    /** 群号 */
    group_id: number;
    /** 群名 */
    group_name: string;
    /** 匿名信息，{@link sub_type} 为`"anonymous"`时该属性有效 */
    anonymous: Anonymous | null;
    /** @todo 未知属性 */
    block: boolean;
    /** 是否AT我 */
    atme: boolean;
    /** 是否AT全体成员 */
    atall: boolean;
    /** 发送方信息 */
    sender: {
        /** 账号 */
        user_id: number;
        /** 昵称 */
        nickname: string;
        /** @todo 未知属性 */
        sub_id: string;
        /** 名片 */
        card: string;
        /** 性别，@deprecated */
        sex: Gender;
        /** 年龄，@deprecated */
        age: number;
        /** 地区，@deprecated */
        area: string;
        /** 等级 */
        level: number;
        /** 权限 */
        role: GroupRole;
        /** 头衔 */
        title: string;
    };
    /** 反序列化一条群消息 */
    static deserialize(serialized: Buffer): GroupMessage;
    constructor(proto: pb.Proto);
}
/** 一条讨论组消息 */
export declare class DiscussMessage extends Message {
    message_type: "discuss";
    /** 讨论组号 */
    discuss_id: number;
    /** 组名 */
    discuss_name: string;
    /** 是否AT我 */
    atme: boolean;
    /** 发送方信息 */
    sender: {
        /** 账号 */
        user_id: number;
        /** 昵称 */
        nickname: string;
        /** 名片 */
        card: string;
    };
    /** 反序列化一条讨论组消息 */
    static deserialize(serialized: Buffer): DiscussMessage;
    constructor(proto: pb.Proto);
}
/** 一条转发消息 */
export declare class ForwardMessage implements Forwardable {
    protected proto: pb.Proto;
    /** @todo 未知属性 */
    private parsed;
    /** 账号 */
    user_id: number;
    /** 昵称 */
    nickname: string;
    /** 若转自群聊，则表示群号 */
    group_id?: number;
    /** 发送时间 */
    time: number;
    /** 发送序号 */
    seq: number;
    /** 消息内容 */
    message: MessageElem[];
    raw_message: string;
    /** 反序列化一条转发消息 */
    static deserialize(serialized: Buffer): ForwardMessage;
    constructor(proto: pb.Proto);
    /** 将转发消息序列化保存 */
    serialize(): Buffer;
    /** 以适合人类阅读的形式输出 */
    toString(): string;
    /** @deprecated 转换为CQ码 */
    toCqcode(): string;
}
