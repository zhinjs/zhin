/// <reference types="node" />
/// <reference types="node" />
/// <reference types="node" />
import { MusicFullInfo, MusicPlatform } from "./music";
/** TEXT (此元素可使用字符串代替) */
export interface TextElem {
    type: "text";
    /** 文字内容 */
    text: string;
}
/** AT */
export interface AtElem {
    type: "at";
    /** 在频道消息中该值为0 */
    qq: number | "all";
    /** 频道中的`tiny_id` */
    id?: string | "all";
    /** AT后跟的字符串，接收消息时有效 */
    text?: string;
    /** 假AT */
    dummy?: boolean;
}
/** 表情 */
export interface FaceElem {
    type: "face" | "sface";
    /** face为0~348，sface不明 */
    id: number;
    /** 表情说明，接收消息时有效 */
    text?: string;
    /** @todo 未知属性 */
    qlottie?: string;
}
/** 原创表情 */
export interface BfaceElem {
    type: "bface";
    /** 暂时只能发收到的file */
    file: string;
    /** 表情说明 */
    text: string;
}
/** 魔法表情 */
export interface MfaceElem {
    /** `rps`表示石头剪刀布，`dice`表示骰子 */
    type: "rps" | "dice";
    /** @todo 待添加属性说明 */
    id?: number;
}
/** 图片 */
export interface ImageElem {
    type: "image";
    /**
     * @type {string} 本地图片文件路径，例如`"/tmp/1.jpg"`
     * @type {Buffer} 图片`Buffer`
     * @type {Readable} 可读的图片数据流
     */
    file: string | Buffer | import("stream").Readable;
    /** 网络图片是否使用缓存 */
    cache?: boolean;
    /** 流的超时时间，默认60(秒) */
    timeout?: number;
    headers?: import("http").OutgoingHttpHeaders;
    /** 图片url地址，接收时有效 */
    url?: string;
    /** 是否作为表情发送 */
    asface?: boolean;
    /** 是否显示下载原图按钮 */
    origin?: boolean;
    /** 图片概要 */
    summary?: string;
    /** 图片fid，接收时有效(QQNT) */
    fid?: string;
    /** 图片md5，接收时有效 */
    md5?: string;
    /** 图片高度，接收时有效 */
    height?: number;
    /** 图片宽度，接收时有效 */
    width?: number;
    /** 图片大小，接收时有效 */
    size?: number;
}
/** 闪照 */
export interface FlashElem extends Omit<ImageElem, "type"> {
    type: "flash";
}
/** 语音 */
export interface PttElem {
    type: "record";
    /**
     * 支持`raw silk`和`amr`文件
     * @type {string} 本地语音文件路径，例如`"/tmp/1.slk"`
     * @type {Buffer} ptt buffer (silk or amr)
     */
    file: string | Buffer;
    /** 语音url地址，接收时有效 */
    url?: string;
    md5?: string;
    /** 文件大小，接收时有效 */
    size?: number;
    /** 语音时长（秒） */
    seconds?: number;
}
/** 视频 */
export interface VideoElem {
    type: "video";
    /**
     * 需要`ffmpeg`和`ffprobe`
     * @type {string} 本地视频文件路径，例如`"/tmp/1.mp4"`
     * @type {Buffer} video buffer
     */
    file: string | Buffer;
    /** 视频名，接收时有效 */
    name?: string;
    /** 作为文件的文件id，接收时有效 */
    fid?: string;
    md5?: string;
    /** 文件大小，接收时有效 */
    size?: number;
    /** 视频时长（秒），接收时有效 */
    seconds?: number;
    /** 发送完成后是否删除文件 */
    temp?: boolean;
}
/** 地点分享 */
export interface LocationElem {
    type: "location";
    /** 地址描述 */
    address: string;
    /** 纬度 */
    lat: number;
    /** 经度 */
    lng: number;
    /** @todo 未知属性 */
    name?: string;
    /** @todo 未知属性 */
    id?: string;
}
/** 链接分享 */
export interface ShareElem {
    type: "share";
    /** 链接地址 */
    url: string;
    /** 链接标题 */
    title: string;
    /** 链接内容，接收时有效 */
    content?: string;
    /** 链接配图，接收时有效 */
    image?: string;
}
/** JSON */
export interface JsonElem {
    type: "json";
    data: any;
}
/** XML */
export interface XmlElem {
    type: "xml";
    data: string;
    id?: number;
}
/** 戳一戳 */
export interface PokeElem {
    type: "poke";
    /** 0~6 */
    id: number;
    /** 动作描述 */
    text?: string;
}
/** Markdown消息 */
export interface MarkdownElem {
    type: "markdown";
    content: string;
}
/** Button消息 */
export interface ButtonElem {
    type: "button";
    content: {
        /** 机器人appid */
        appid: number;
        /** rows 数组的每个元素表示每一行按钮 */
        rows: {
            buttons: Button[];
        }[];
    };
}
export interface Button {
    /** 按钮ID：在一个keyboard消息内设置唯一 */
    id?: string;
    render_data: {
        /** 按钮上的文字 */
        label: string;
        /** 点击后按钮的上文字 */
        visited_label: string;
        /** 按钮样式：0 灰色线框，1 蓝色线框 */
        style: number;
    };
    action: {
        /** 设置 0 跳转按钮：http 或 小程序 客户端识别 scheme，设置 1 回调按钮：回调后台接口, data 传给后台，设置 2 指令按钮：自动在输入框插入 @bot data */
        type: number;
        permission: {
            /** 0 指定用户可操作，1 仅管理者可操作，2 所有人可操作，3 指定身份组可操作（仅频道可用） */
            type: number;
            /** 有权限的用户 id 的列表 */
            specify_user_ids?: Array<string>;
            /** 有权限的身份组 id 的列表（仅频道可用） */
            specify_role_ids?: Array<string>;
        };
        /** 操作相关的数据 */
        data: string;
        /** 指令按钮可用，指令是否带引用回复本消息，默认 false。支持版本 8983 */
        reply?: boolean;
        /** 指令按钮可用，点击按钮后直接自动发送 data，默认 false。支持版本 8983 */
        enter?: boolean;
        /** 本字段仅在指令按钮下有效，设置后后会忽略 action.enter 配置。
        设置为 1 时 ，点击按钮自动唤起启手Q选图器，其他值暂无效果。
        （仅支持手机端版本 8983+ 的单聊场景，桌面端不支持） */
        anchor?: number;
        /**【已弃用】可操作点击的次数，默认不限 */
        click_limit?: number;
        /** 【已弃用】指令按钮可用，弹出子频道选择器，默认 false */
        at_bot_show_channel_list?: boolean;
        /** 客户端不支持本action的时候，弹出的toast文案 */
        unsupport_tips: string;
    };
}
/** 特殊 (官方客户端无法解析此消息) */
export interface MiraiElem {
    type: "mirai";
    data: string;
}
/** 文件，只支持接收，发送请使用文件专用API */
export interface FileElem {
    type: "file";
    /** 文件名 */
    name: string;
    /** 文件id */
    fid: string;
    md5: string;
    /** 文件大小 */
    size: number;
    /** 存在时间 */
    duration: number;
}
/** @deprecated @cqhttp 旧版引用回复，仅做一定程度的兼容 */
export interface ReplyElem {
    type: "reply";
    text?: string;
    id: string;
}
/** 分享音乐 */
export interface MusicElem extends Partial<MusicFullInfo> {
    type: 'music';
    /** 音乐id */
    id: string;
    /** 音乐平台 */
    platform: MusicPlatform;
}
/** 可引用回复的消息 */
export interface Quotable {
    /** 消息发送方账号 */
    user_id: number;
    time: number;
    seq: number;
    /** 私聊回复必须包含此属性 */
    rand: number;
    /** 收到的引用回复永远是字符串 */
    message: Sendable;
}
/** 引用回复消息 */
export interface QuoteElem extends Quotable {
    type: 'quote';
}
/** 可转发的消息 */
export interface Forwardable {
    /** 消息发送方账号 */
    user_id: number;
    /** 发送的消息 */
    message: Sendable;
    /** 发送方昵称，接收时有效 */
    nickname?: string;
    /** 发送时间，接收时有效 */
    time?: number;
}
/** 可转发节点 */
export interface ForwardNode extends Forwardable {
    type: 'node';
}
/** 可组合发送的元素 */
export type ChainElem = TextElem | FaceElem | BfaceElem | MfaceElem | ImageElem | AtElem | MiraiElem | ReplyElem | ForwardNode | QuoteElem | MarkdownElem | ButtonElem;
export declare const ChainElemTypes: ChainElem["type"][];
/** 注意：只有`ChainElem`中的元素可以组合发送，其他元素只能单独发送 */
export type MessageElem = TextElem | FaceElem | BfaceElem | MfaceElem | ImageElem | AtElem | MiraiElem | ReplyElem | FlashElem | PttElem | VideoElem | JsonElem | XmlElem | PokeElem | LocationElem | ShareElem | MusicElem | FileElem | ForwardNode | QuoteElem | MarkdownElem | ButtonElem;
/** 可通过`sendMsg`发送的类型集合 (字符串、元素对象，或它们的数组) */
export type Sendable = string | MessageElem | (string | MessageElem)[];
/** 用于构造消息元素 */
export declare const segment: {
    /** @deprecated 文本，建议直接使用字符串 */
    text(text: string): TextElem;
    /** 经典表情(id=0~324) */
    face(id: number): FaceElem;
    /** 小表情(id规则不明) */
    sface(id: number, text?: string): FaceElem;
    /** 原创表情(file规则不明) */
    bface(file: string, text: string): BfaceElem;
    /** 猜拳(id=1~3) */
    rps(id?: number): MfaceElem;
    /** 骰子(id=1~6) */
    dice(id?: number): MfaceElem;
    /** mention@提及
     * @param qq 全体成员:"all", 频道:tiny_id
     */
    at(qq: number | "all" | string, text?: string, dummy?: boolean): AtElem;
    /** 图片，支持http://,base64:// */
    image(file: ImageElem["file"], cache?: boolean, timeout?: number, headers?: import("http").OutgoingHttpHeaders): ImageElem;
    /** 闪照，支持http://,base64:// */
    flash(file: ImageElem["file"], cache?: boolean, timeout?: number, headers?: import("http").OutgoingHttpHeaders): FlashElem;
    /** 语音，支持http://,base64:// */
    record(file: string | Buffer, data?: any): PttElem;
    /** 视频，支持http://,base64:// */
    video(file: string | Buffer, data?: any): VideoElem;
    json(data: any): JsonElem;
    xml(data: string, id?: number): XmlElem;
    markdown(content: string): MarkdownElem;
    button(content: ButtonElem["content"]): ButtonElem;
    /** 一种特殊消息(官方客户端无法解析) */
    mirai(data: string): MiraiElem;
    /** 音乐 */
    music(id: string, platform?: MusicPlatform): Promise<JsonElem>;
    fake(user_id: number, message: Sendable, nickname?: string, time?: number): ForwardNode;
    /** 链接分享 */
    share(url: string, title: string, image?: string, content?: string): ShareElem;
    /** 位置分享 */
    location(lat: number, lng: number, address: string, id?: string): LocationElem;
    /** id 0~6 */
    poke(id: number): PokeElem;
    /** @deprecated 将CQ码转换为消息链 */
    fromCqcode(str: string): MessageElem[];
};
